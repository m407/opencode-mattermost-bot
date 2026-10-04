import { t } from "../i18n/index.js";
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { FilePartInput } from "../opencode/types.js";
import { config } from "../config.js";
import { opencodeClient } from "../opencode/client.js";
import { subscribeToEvents, stopEventListening, type EventEnvelope } from "../opencode/events.js";
import { checkOpencodeHealth } from "../opencode/server-health.js";
import { canStartLocalOpencodeServer } from "../opencode/local-start.js";
import {
  resolveLocalOpencodeTarget,
  startLocalOpencodeServer,
  findServerPid,
  killServerProcess,
} from "../opencode/process.js";
import { isContainerRuntime } from "../runtime/container.js";
import { getBotVersion } from "../runtime/bot-version.js";
import { getRuntimePaths } from "../runtime/paths.js";
import { logger } from "../utils/logger.js";
import { extractErrorMessage } from "../utils/opencode-error.js";
import * as settings from "../app/stores/settings-store.js";
import {
  getCurrentSession,
  setCurrentSession,
  clearSession,
} from "../app/services/session-service.js";
import { getListedProjects, getProjectByWorktree } from "../app/services/project-service.js";
import {
  getProviders,
  getProviderModels,
  getStoredModel,
  searchModels,
  selectModel,
  getModelAvailability,
} from "../app/services/model-selection-service.js";
import {
  getAvailableAgents,
  getStoredAgent,
  selectAgent,
  applyAgentConfiguredSettings,
} from "../app/services/agent-selection-service.js";
import {
  getAvailableVariants,
  setCurrentVariant,
  validateVariantForModel,
} from "../app/services/variant-selection-service.js";
import { applySessionSettings } from "../app/services/session-settings-service.js";
import { loadRecentSessions } from "../app/services/recent-sessions-service.js";
import {
  loadLatestAssistantResponse,
  loadUserMessages,
} from "../app/services/message-history-service.js";
import { loadCommandCatalog } from "../app/services/command-catalog-service.js";
import { loadSkillsCatalog } from "../app/services/skills-catalog-service.js";
import { loadMcpCatalog, toggleMcpCatalogServer } from "../app/services/mcp-catalog-service.js";
import { getCurrentFolderWorktreeContext } from "../app/services/worktree-service.js";
import { LocalCommandRegistry } from "../app/services/local-command-registry.js";
import {
  initBrowserRoots,
  isWithinAllowedRootSafe,
  scanLsDirectory,
  MAX_ENTRIES_PER_PAGE,
} from "../app/services/file-browser-service.js";
import { transcribeAudio, isSttConfigured } from "../app/services/stt-service.js";
import {
  extractDocument,
  isDocExtractorConfigured,
} from "../app/services/document-extractor-service.js";
import { isTextFileName, toDataUri } from "../app/services/file-download-service.js";
import { ScheduledTaskRuntime } from "../app/services/scheduled-task-runtime-service.js";
import { ForegroundSessionState } from "../app/managers/foreground-session-state-manager.js";
import { parseTaskSchedule } from "../app/services/scheduled-task-schedule-parser-service.js";
import {
  addScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
} from "../app/stores/scheduled-task-store.js";
import { createScheduledTaskModel, type ScheduledTask } from "../app/types/scheduled-task.js";
import type { SessionInfo } from "../app/types/session.js";
import { MattermostActions } from "./actions.js";
import { MattermostClient, type MattermostPost } from "./client.js";
import { MattermostEvents, type MattermostPostEvent } from "./events.js";
import { MattermostMessages, type ReplyTarget } from "./messages.js";
import { MattermostInteractions } from "./interactions.js";
import { MattermostActivity } from "./activity.js";
import { BOT_COMMANDS, BUILT_IN_COMMAND_NAMES } from "../bot/commands/definitions.js";

interface Prompt {
  text: string;
  files: FilePartInput[];
  target: ReplyTarget;
  audio: boolean;
  session: SessionInfo;
  agent: string;
  model: ReturnType<typeof getStoredModel>;
}

/** A single authorized user and channel; replies retain the task's real Mattermost root post. */
export class MattermostBot {
  readonly messages: MattermostMessages;
  readonly actions: MattermostActions | undefined;
  readonly foreground = new ForegroundSessionState();
  readonly scheduler = new ScheduledTaskRuntime(this.foreground);
  readonly interactions: MattermostInteractions;
  readonly activity: MattermostActivity;
  private readonly events: MattermostEvents;
  private commands = Promise.resolve();
  private eventDelivery = Promise.resolve();
  private eventCount = 0;
  private reconcileNeeded = false;
  private recoveryTimer: ReturnType<typeof setInterval> | undefined;
  private queued: Prompt[] = [];
  private attachedFiles: FilePartInput[] = [];
  private localCommands = LocalCommandRegistry.empty();
  private stopped = false;
  private startedAt = Date.now();
  private dashboard: Promise<void> = Promise.resolve();

  constructor(
    readonly client = new MattermostClient(config.mattermost.url, config.mattermost.token),
  ) {
    this.actions = config.mattermost.callbackUrl
      ? new MattermostActions(`${config.mattermost.callbackUrl}/actions`, async (data, request) => {
          // Acknowledge promptly; the shared command queue serializes callbacks and chat commands.
          void this.enqueue(async () => {
            const post = await this.client.getPost(request.post_id);
            await this.command(data, {
              channelId: request.channel_id,
              rootId: post.root_id || post.id,
            });
          });
          return { ephemeral_text: t("mattermost.bot.processing") };
        })
      : undefined;
    this.messages = new MattermostMessages(client, config.mattermost.allowedUserId, this.actions);
    this.interactions = new MattermostInteractions(this.messages);
    this.activity = new MattermostActivity(
      this.messages,
      this.interactions,
      this.foreground,
      () => this.target(),
      (error) => this.report(error),
      () => this.idle(),
    );
    this.events = new MattermostEvents(client, {
      allowedUserId: config.mattermost.allowedUserId,
      allowedChannelIds: [config.mattermost.channelId],
      onPost: (event) => this.accept(event),
      onConnected: async () => {
        this.deliverWork(() => this.activity.reconcile());
      },
      onError: (error) => this.report(error),
    });
  }

  target(): ReplyTarget {
    const rootId = settings.getReplyRootId();
    return { channelId: config.mattermost.channelId, ...(rootId ? { rootId } : {}) };
  }

  private report(error: unknown): void {
    logger.error("[MattermostBot] Operation failed", error);
  }

  private enqueue(work: () => Promise<void>, target = this.target()): Promise<void> {
    const pending = this.commands.then(async () => {
      if (!this.stopped) await work();
    });
    this.commands = pending.catch(async (error: unknown) => {
      this.report(error);
      await this.messages
        .send(target, t("mattermost.bot.operation_failed", { value1: extractErrorMessage(error) }))
        .catch((sendError: unknown) => this.report(sendError));
    });
    return this.commands;
  }

  async start(): Promise<void> {
    this.startedAt = Date.now();
    await settings.loadSettings();
    initBrowserRoots(config.open.browserRoots);
    this.localCommands = await LocalCommandRegistry.load({
      directoryPath: getRuntimePaths().localCommandsDirPath,
      builtInCommands: BUILT_IN_COMMAND_NAMES,
    });
    await this.scheduler.initialize({
      send: async (delivery) => {
        await this.messages.send(
          { channelId: config.mattermost.channelId },
          [delivery.notificationText, delivery.resultText, delivery.footerText]
            .filter(Boolean)
            .join("\n\n"),
        );
        return true;
      },
    });
    if (getCurrentSession()) this.subscribe(getCurrentSession()!.directory);
    await this.events.start();
    this.recoveryTimer = setInterval(() => {
      if (this.eventCount === 0) this.deliverWork(() => this.activity.reconcile());
    }, 15000);
    this.recoveryTimer.unref();
    logger.info("[MattermostBot] Started");
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.recoveryTimer);
    this.scheduler.shutdown();
    stopEventListening();
    await this.events.stop();
    await this.commands;
    await this.eventDelivery;
    await this.activity.reset();
    await this.dashboard;
    await settings.flushSettings();
  }

  accept({ kind, post }: MattermostPostEvent): Promise<void> {
    if (
      kind !== "posted" ||
      post.user_id !== config.mattermost.allowedUserId ||
      post.channel_id !== config.mattermost.channelId ||
      post.delete_at ||
      post.type.startsWith("system_")
    )
      return Promise.resolve();
    const target = { channelId: post.channel_id, rootId: post.root_id || post.id };
    if (post.create_at < this.startedAt || Date.now() - post.create_at > 60_000) {
      return this.messages
        .send(target, t("mattermost.bot.this_message_arrived_after_an_outage_and_was_not_execut"))
        .then(() => undefined);
    }
    return this.enqueue(async () => {
      if (post.message.startsWith("!")) await this.command(post.message.slice(1), target);
      else await this.prompt(post, target);
    }, target);
  }

  acceptCommand(text: string, rootId?: string): void {
    const target = { channelId: config.mattermost.channelId, ...(rootId ? { rootId } : {}) };
    void this.enqueue(() => this.command(text || "help", target), target);
  }

  private subscribe(directory: string): void {
    void subscribeToEvents(
      directory,
      (envelope) => this.deliverEvent(envelope),
      () => {
        this.deliverWork(() => this.activity.reconcile());
      },
    ).catch((error: unknown) => this.report(error));
  }

  private deliverEvent(envelope: EventEnvelope): void {
    this.deliverWork(() => this.activity.event(envelope));
  }
  private deliverWork(work: () => Promise<void>): void {
    if (this.stopped) return;
    if (this.eventCount >= 2000) {
      this.reconcileNeeded = true;
      return;
    }
    this.eventCount++;
    this.eventDelivery = this.eventDelivery
      .then(async () => {
        if (!this.stopped) await work();
      })
      .catch((error: unknown) => this.report(error))
      .finally(() => {
        this.eventCount--;
        if (!this.eventCount && this.reconcileNeeded) {
          this.reconcileNeeded = false;
          this.deliverWork(() => this.activity.reconcile());
        }
      });
  }

  private requireProject(): string {
    const project = settings.getCurrentProject();
    if (!project)
      throw new Error(t("mattermost.bot.choose_a_project_with_projects_or_open_path_first"));
    return project.worktree;
  }
  private requireSession(): SessionInfo {
    const session = getCurrentSession();
    if (!session)
      throw new Error(t("mattermost.bot.create_or_select_a_session_with_new_or_sessions"));
    return session;
  }
  private requireIdle(): void {
    if (this.foreground.isBusy())
      throw new Error(t("mattermost.bot.the_session_is_busy_use_abort_or_detach_first"));
  }

  private async follow(session: SessionInfo, target: ReplyTarget, baseline = true): Promise<void> {
    await this.activity.reset();
    await this.interactions.clear();
    this.queued = [];
    this.attachedFiles = [];
    this.foreground.clearAll("session_changed");
    setCurrentSession(session);
    settings.setReplyRootId(target.rootId);
    settings.setCurrentProject({
      id: session.directory,
      name: path.basename(session.directory),
      worktree: session.directory,
    });
    if (baseline) await this.activity.baseline(session.directory, session.id);
    this.subscribe(session.directory);
    await this.activity.reconcile();
    await this.updateDashboard();
  }

  private async selectProject(directory: string, target: ReplyTarget): Promise<void> {
    this.requireIdle();
    const project = await getProjectByWorktree(directory).catch(() => ({
      id: directory,
      name: path.basename(directory),
      worktree: directory,
    }));
    // Probe through OpenCode so remote-server directories are supported as well.
    const check = await opencodeClient.file.list({ path: directory });
    if (check.error) throw check.error;
    await this.activity.reset();
    await this.interactions.clear();
    clearSession();
    stopEventListening();
    this.queued = [];
    this.attachedFiles = [];
    settings.setCurrentProject(project);
    settings.setReplyRootId(target.rootId);
    await this.messages.send(
      target,
      t("mattermost.bot.project_use_new_to_create_a_session", {
        value1: project.name,
        value2: directory,
      }),
    );
    await this.updateDashboard();
  }

  async command(input: string, target: ReplyTarget): Promise<void> {
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(input.trim());
    const command = match?.[1]?.toLowerCase() || "help";
    const args = match?.[2]?.trim() ?? "";
    switch (command) {
      case "start":
      case "help":
        await this.messages.send(
          target,
          t("mattermost.bot.opencode_mattermost_bot_send_a_message_to_run_a_task_co", {
            value1: BOT_COMMANDS.map((c) => `\`!${c.command}\` — ${c.description}`).join("\n"),
            value2: this.localCommands
              .definitions()
              .map((c) => `\`!${c.command}\` — ${c.description}`)
              .join("\n"),
          }),
        );
        return;
      case "status": {
        const health = await checkOpencodeHealth();
        const session = getCurrentSession();
        const model = getStoredModel();
        await this.messages.send(
          target,
          t("mattermost.bot.opencode_mattermost_bot_server_project_session_agent_mo", {
            value1: await getBotVersion(),
            value2: health.healthy ? "online" : "offline",
            value3: "v2",
            value4: settings.getCurrentProject()?.worktree ?? "none",
            value5: session?.title ?? "none",
            value6: getStoredAgent(),
            value7: model.providerID,
            value8: model.modelID,
            value9: model.variant ?? "default",
            value10: this.foreground.isBusy() ? "running" : "idle",
            value11: this.queued.length,
          }),
        );
        return;
      }
      case "new": {
        this.requireIdle();
        const directory = this.requireProject();
        const { data, error } = await opencodeClient.session.create({
          directory,
          ...(args ? { title: args } : {}),
        });
        if (error || !data) throw error || new Error(t("mattermost.bot.could_not_create_session"));
        await this.follow({ id: data.id, directory, title: data.title }, target);
        await this.messages.send(
          target,
          t("mattermost.bot.session_created", { value1: data.title }),
        );
        return;
      }
      case "abort": {
        const session = this.requireSession();
        const { error } = await opencodeClient.session.abort({
          sessionID: session.id,
          directory: session.directory,
        });
        if (error) throw error;
        this.queued = [];
        this.foreground.markIdle(session.id);
        await this.activity.reset();
        await this.interactions.clear();
        await this.messages.send(target, t("mattermost.bot.task_stopped_queued_prompts_cleared"));
        return;
      }
      case "detach":
        this.queued = [];
        this.attachedFiles = [];
        await this.activity.reset();
        await this.interactions.clear();
        clearSession();
        this.foreground.clearAll("detached");
        stopEventListening();
        settings.setReplyRootId(undefined);
        await this.messages.send(
          target,
          t("mattermost.bot.detached_local_queued_prompts_cleared_the_opencode_task"),
        );
        return;
      case "projects": {
        if (args) {
          const projects = await getListedProjects();
          const chosen = projects.find((p) => p.id === args || p.worktree === args);
          if (!chosen) throw new Error(t("mattermost.bot.project_not_found"));
          await this.selectProject(chosen.worktree, target);
          return;
        }
        const projects = await getListedProjects();
        await this.list(
          target,
          t("mattermost.bot.projects"),
          projects.map((p) => ({ name: p.name ?? p.worktree, data: `projects ${p.worktree}` })),
        );
        return;
      }
      case "open":
        if (!args) throw new Error(t("mattermost.bot.use_open_project_directory"));
        await this.selectProject(args, target);
        return;
      case "sessions":
      case "recent": {
        if (args) {
          this.requireIdle();
          const directory = this.requireProject();
          const { data, error } = await opencodeClient.session.get({ sessionID: args, directory });
          if (error || !data) throw error || new Error(t("mattermost.bot.session_not_found"));
          await applySessionSettings(data);
          await this.follow({ id: data.id, directory: data.directory, title: data.title }, target);
          const latest = await loadLatestAssistantResponse(data.id, data.directory);
          await this.messages.send(
            target,
            t("mattermost.bot.following", {
              value1: data.title,
              value2: latest ? `\n\n${latest}` : "",
            }),
          );
          return;
        }
        const recent = await loadRecentSessions(config.bot.sessionsListLimit);
        await this.list(
          target,
          t("mattermost.bot.sessions"),
          recent.map(({ session, status }) => ({
            name: `${session.title} (${status})`,
            data: `follow ${encodeURIComponent(session.directory)} ${session.id}`,
          })),
        );
        return;
      }
      case "follow": {
        this.requireIdle();
        const [directory, id] = args.split(" ");
        if (!directory || !id)
          throw new Error(t("mattermost.bot.use_the_session_list_to_select_a_session"));
        const { data, error } = await opencodeClient.session.get({
          directory: decodeURIComponent(directory),
          sessionID: id,
        });
        if (error || !data) throw error || new Error(t("mattermost.bot.session_not_found"));
        await applySessionSettings(data);
        await this.follow({ id: data.id, directory: data.directory, title: data.title }, target);
        await this.messages.send(target, t("mattermost.bot.following_20", { value1: data.title }));
        return;
      }
      case "rename": {
        const session = this.requireSession();
        if (!args) throw new Error(t("mattermost.bot.use_rename_title"));
        const { error } = await opencodeClient.session.update({
          sessionID: session.id,
          directory: session.directory,
          title: args,
        });
        if (error) throw error;
        setCurrentSession({ ...session, title: args });
        await this.updateDashboard();
        await this.messages.send(target, t("mattermost.bot.session_renamed", { value1: args }));
        return;
      }
      case "models": {
        const choices = args
          ? await searchModels(args)
          : (await getProviders()).flatMap((p) => [{ providerID: p.id, modelID: "" }]);
        await this.list(
          target,
          t("mattermost.bot.models"),
          choices.map((m) => ({
            name: `${m.providerID}${m.modelID ? `/${m.modelID}` : ""}`,
            data: m.modelID ? `model ${m.providerID}/${m.modelID}` : `provider ${m.providerID}`,
          })),
        );
        return;
      }
      case "provider":
        await this.list(
          target,
          t("mattermost.bot.models"),
          (await getProviderModels(args)).map((m) => ({
            name: m.modelID,
            data: `model ${m.providerID}/${m.modelID}`,
          })),
        );
        return;
      case "model": {
        this.requireIdle();
        const slash = args.indexOf("/");
        if (slash < 1) throw new Error(t("mattermost.bot.use_model_provider_model"));
        const model = { providerID: args.slice(0, slash), modelID: args.slice(slash + 1) };
        if ((await getModelAvailability(model.providerID, model.modelID)) !== "offered")
          throw new Error(t("mattermost.bot.model_is_not_available"));
        selectModel({ ...model, variant: "default" });
        await this.updateDashboard();
        await this.messages.send(target, t("mattermost.bot.model", { value1: args }));
        return;
      }
      case "agent": {
        const agents = await getAvailableAgents();
        if (!args) {
          await this.list(
            target,
            t("mattermost.bot.agents"),
            agents.map((a) => ({ name: a.name, data: `agent ${a.name}` })),
          );
          return;
        }
        this.requireIdle();
        if (!agents.some((a) => a.name === args))
          throw new Error(t("mattermost.bot.unknown_agent"));
        selectAgent(args);
        await applyAgentConfiguredSettings(args);
        await this.updateDashboard();
        await this.messages.send(target, t("mattermost.bot.agent", { value1: args }));
        return;
      }
      case "variant": {
        const model = getStoredModel();
        if (!args) {
          await this.list(
            target,
            t("mattermost.bot.variants"),
            (await getAvailableVariants(model.providerID, model.modelID))
              .filter((v) => !v.disabled)
              .map((v) => ({ name: v.id, data: `variant ${v.id}` })),
          );
          return;
        }
        this.requireIdle();
        if (!(await validateVariantForModel(model.providerID, model.modelID, args)))
          throw new Error(t("mattermost.bot.unknown_variant"));
        setCurrentVariant(args);
        await this.updateDashboard();
        await this.messages.send(target, t("mattermost.bot.variant", { value1: args }));
        return;
      }
      case "context": {
        const session = this.requireSession();
        const { data, error } = await opencodeClient.session.messages({
          sessionID: session.id,
          directory: session.directory,
          limit: 100,
        });
        if (error) throw error;
        const latest = data
          ?.slice()
          .reverse()
          .find((message) => message.info.role === "assistant")?.info;
        await this.messages.send(
          target,
          latest?.role === "assistant"
            ? t("mattermost.bot.context_model_tokens_cost", {
                value1: latest.providerID,
                value2: latest.modelID,
                value3: JSON.stringify(latest.tokens),
                value4: latest.cost,
              })
            : t("mattermost.bot.no_assistant_usage_yet"),
        );
        return;
      }
      case "revert": {
        this.requireIdle();
        const session = this.requireSession();
        if (!args)
          throw new Error(
            t("mattermost.bot.use_messages_to_find_a_message_id_then_revert_message_i"),
          );
        const { error } = await opencodeClient.session.revert({
          sessionID: session.id,
          directory: session.directory,
          messageID: args,
        });
        if (error) throw error;
        await this.messages.send(
          target,
          t("mattermost.bot.session_reverted_send_the_replacement_prompt"),
        );
        return;
      }
      case "fork": {
        this.requireIdle();
        const session = this.requireSession();
        const { data, error } = await opencodeClient.session.fork({
          sessionID: session.id,
          directory: session.directory,
          ...(args ? { messageID: args } : {}),
        });
        if (error || !data) throw error || new Error(t("mattermost.bot.could_not_fork_session"));
        await this.follow({ id: data.id, title: data.title, directory: data.directory }, target);
        await this.messages.send(
          target,
          t("mattermost.bot.following_fork", { value1: data.title }),
        );
        return;
      }
      case "messages": {
        const session = this.requireSession();
        const latest = await loadLatestAssistantResponse(session.id, session.directory);
        const history = (await loadUserMessages(session.id, session.directory)).slice(
          -config.bot.messagesListLimit,
        );
        await this.messages.send(
          target,
          t("mattermost.bot.recent_prompts_latest_response", {
            value1: history
              .map((m) => `${new Date(m.created).toISOString()} — ${m.text}\n\`!revert ${m.id}\``)
              .join("\n\n"),
            value2: latest ?? "No response yet.",
          }),
        );
        return;
      }
      case "commands":
      case "skills": {
        if (args) {
          await this.runOpenCodeCommand(args, target);
          return;
        }
        const entries =
          command === "skills"
            ? await loadSkillsCatalog(this.requireProject())
            : await loadCommandCatalog(this.requireProject());
        await this.list(
          target,
          command,
          entries.map((c) => ({ name: c.name, data: `commands ${c.name}` })),
        );
        return;
      }
      case "mcps": {
        const directory = this.requireProject();
        if (args) {
          const [name, enabled] = args.split(" ");
          if (!name || !["on", "off"].includes(enabled ?? ""))
            throw new Error(t("mattermost.bot.use_mcps_name_on_off"));
          await toggleMcpCatalogServer(directory, name, enabled === "on");
        }
        await this.list(
          target,
          t("mattermost.bot.mcp_servers"),
          (await loadMcpCatalog(directory)).map((m) => ({
            name: `${m.name}: ${m.status.status}`,
            data: `mcps ${m.name} ${m.status.status === "connected" ? "off" : "on"}`,
          })),
        );
        return;
      }
      case "worktree": {
        if (args) {
          await this.selectProject(args, target);
          return;
        }
        const context = await getCurrentFolderWorktreeContext(this.requireProject());
        if (!context) throw new Error(t("mattermost.bot.the_project_is_not_a_git_worktree"));
        await this.list(
          target,
          t("mattermost.bot.worktrees"),
          context.worktrees.map((w) => ({
            name: `${w.branch ?? "detached"}: ${w.path}`,
            data: `worktree ${w.path}`,
          })),
        );
        return;
      }
      case "compact": {
        this.requireIdle();
        const session = this.requireSession();
        const { error } = await opencodeClient.session.summarize({
          sessionID: session.id,
          directory: session.directory,
        });
        if (error) throw error;
        await this.messages.send(target, t("mattermost.bot.session_compacted"));
        return;
      }
      case "reload": {
        const { error } = await opencodeClient.location.reload();
        if (error) throw error;
        await this.activity.reconcile();
        await this.messages.send(target, t("mattermost.bot.opencode_configuration_reloaded"));
        return;
      }
      case "opencode_start":
      case "opencode_stop": {
        if (isContainerRuntime())
          throw new Error(t("runtime.container.command_unavailable", { command }));
        const local = resolveLocalOpencodeTarget(config.opencode.apiUrl);
        if (!local)
          throw new Error(
            t("mattermost.bot.process_management_is_only_available_for_a_local_openco"),
          );
        if (command === "opencode_start") {
          if ((await checkOpencodeHealth()).healthy) {
            await this.messages.send(target, t("mattermost.bot.opencode_is_already_running"));
            return;
          }
          if (!(await canStartLocalOpencodeServer(local, "always")))
            throw new Error(t("mattermost.bot.opencode_cannot_be_started_see_the_bot_logs"));
          await startLocalOpencodeServer(local);
          if (getCurrentSession()) this.subscribe(getCurrentSession()!.directory);
          await this.messages.send(target, t("mattermost.bot.opencode_startup_requested"));
        } else {
          if (!(await checkOpencodeHealth()).healthy)
            throw new Error(t("mattermost.bot.could_not_stop_opencode"));
          const pid = await findServerPid(local.port);
          if (pid && !(await killServerProcess(pid)))
            throw new Error(t("mattermost.bot.could_not_stop_opencode"));
          await this.activity.reset();
          await this.interactions.clear();
          this.queued = [];
          this.foreground.clearAll("server_stopped");
          await this.messages.send(target, t("mattermost.bot.opencode_stopped"));
        }
        return;
      }
      case "settings":
        await this.configure(args, target);
        return;
      case "ls":
      case "download":
      case "attach":
        await this.files(command, args, target);
        return;
      case "task":
      case "tasklist":
        await this.tasks(command, args, target);
        return;
      case "permission":
      case "answer":
      case "cancel": {
        const separator = args.indexOf(" ");
        const id = separator < 0 ? args : args.slice(0, separator);
        const value = separator < 0 ? "" : args.slice(separator + 1);
        await this.interactions.answer(id, value, target, command === "cancel");
        return;
      }
      default:
        if (this.localCommands.has(command)) {
          if (this.foreground.isBusy() && !this.localCommands.allowsWhenBusy(command))
            this.requireIdle();
          const result = await this.localCommands.execute(command);
          await this.messages.send(
            target,
            result.kind === "success"
              ? result.text
              : t("mattermost.bot.local_command", { value1: result.kind }),
          );
          return;
        }
        await this.runOpenCodeCommand(input, target);
    }
  }

  private async list(
    target: ReplyTarget,
    title: string,
    items: { name: string; data: string }[],
  ): Promise<void> {
    if (!items.length) {
      await this.messages.send(target, t("mattermost.bot.no_entries", { value1: title }));
      return;
    }
    // Each page remains usable without HTTP callbacks through its exact text command.
    for (let index = 0; index < items.length; index += 20) {
      const page = items.slice(index, index + 20);
      await this.messages.card(
        target,
        `**${title}**\n${page.map((item) => `${item.name}\n\`!${item.data}\``).join("\n\n")}`,
        page,
      );
    }
  }

  private async configure(args: string, target: ReplyTarget): Promise<void> {
    const toggles: Record<string, { get: () => boolean; set: (value: boolean) => void }> = {
      thinking: { get: settings.getShowThinkingContent, set: settings.setShowThinkingContent },
      compact: { get: settings.getCompactOutputMode, set: settings.setCompactOutputMode },
      footer: { get: settings.getShowAssistantRunFooter, set: settings.setShowAssistantRunFooter },
      pinned: { get: settings.getPinnedDashboardEnabled, set: settings.setPinnedDashboardEnabled },
      diffs: { get: settings.getSendDiffFileAttachments, set: settings.setSendDiffFileAttachments },
      delete_progress: {
        get: settings.getDeleteCompactProgressOnFinish,
        set: settings.setDeleteCompactProgressOnFinish,
      },
    };
    if (!args) {
      await this.list(target, t("mattermost.bot.settings"), [
        ...Object.entries(toggles).map(([key, value]) => ({
          name: `${key}: ${value.get() ? "on" : "off"}`,
          data: `settings ${key} ${value.get() ? "off" : "on"}`,
        })),
        ...["off", "queue", "steer"].map((value) => ({
          name: t("mattermost.bot.queue", { value1: value }),
          data: `settings queue ${value}`,
        })),
        ...["off", "all", "auto"].map((value) => ({
          name: t("mattermost.bot.audio", { value1: value }),
          data: `settings tts ${value}`,
        })),
      ]);
      return;
    }
    const [key, value] = args.split(" ");
    if (key && toggles[key] && ["on", "off"].includes(value ?? ""))
      toggles[key]!.set(value === "on");
    else if (key === "queue" && ["off", "queue", "steer"].includes(value ?? ""))
      settings.setPromptQueueMode(value as "off" | "queue" | "steer");
    else if (key === "tts" && ["off", "all", "auto"].includes(value ?? ""))
      settings.setTtsMode(value as "off" | "all" | "auto");
    else
      throw new Error(t("mattermost.bot.invalid_setting_use_settings_to_list_available_choices"));
    await settings.flushSettings();
    await this.updateDashboard();
    await this.messages.send(
      target,
      t("mattermost.bot.setting_updated", { value1: key, value2: value }),
    );
  }

  private async files(command: string, argument: string, target: ReplyTarget): Promise<void> {
    const pageMatch = command === "ls" ? /(?:^|\s)--page (\d+)$/.exec(argument) : null;
    const page = pageMatch ? Math.max(0, Number(pageMatch[1]) - 1) : 0;
    const filePath = pageMatch ? argument.slice(0, pageMatch.index).trim() : argument;
    const candidate = path.resolve(this.requireProject(), filePath || ".");
    if (!(await isWithinAllowedRootSafe(candidate)))
      throw new Error(t("mattermost.bot.path_is_outside_the_configured_browser_roots"));
    if (command === "ls") {
      const result = await scanLsDirectory(candidate, page);
      if ("error" in result) throw new Error(result.error);
      const items = result.entries.map((entry) => ({
        name: `${entry.type === "directory" ? "📁" : "📄"} ${entry.name}`,
        data: `${entry.type === "directory" ? "ls" : "download"} ${entry.fullPath}`,
      }));
      if (result.page > 0) items.push({ name: "←", data: `ls ${candidate} --page ${result.page}` });
      if ((result.page + 1) * MAX_ENTRIES_PER_PAGE < result.totalCount)
        items.push({ name: "→", data: `ls ${candidate} --page ${result.page + 2}` });
      await this.list(target, `${candidate} (${result.page + 1})`, items);
      return;
    }

    const canonical = await realpath(candidate);
    const details = await stat(canonical);
    if (!details.isFile() || details.size > config.files.maxFileSizeKb * 1024)
      throw new Error(t("mattermost.bot.file_is_not_a_regular_file_or_exceeds_code_file_max_siz"));
    const data = await readFile(canonical);
    const filename = path.basename(canonical);
    if (command === "download")
      await this.client.sendFile(
        {
          channel_id: target.channelId,
          message: filename,
          ...(target.rootId ? { root_id: target.rootId } : {}),
        },
        filename,
        data,
      );
    else {
      if (this.attachedFiles.length >= 10)
        throw new Error(t("mattermost.bot.at_most_local_files_may_be_attached_to_the_next_prompt"));
      if (!isTextFileName(filename))
        throw new Error(
          t("mattermost.bot.use_a_mattermost_upload_for_images_and_binary_documents"),
        );
      this.attachedFiles.push({
        type: "file",
        filename,
        mime: "text/plain",
        url: toDataUri(data, "text/plain"),
      });
      await this.messages.send(
        target,
        t("mattermost.bot.attached_to_your_next_prompt", { value1: filename }),
      );
    }
  }

  private async tasks(command: string, args: string, target: ReplyTarget): Promise<void> {
    if (command === "tasklist") {
      if (args.startsWith("delete ")) {
        const id = args.slice(7);
        await removeScheduledTask(id);
        this.scheduler.removeTask(id);
      }
      const tasks = listScheduledTasks();
      await this.list(
        target,
        t("mattermost.bot.scheduled_tasks"),
        tasks.map((task) => ({
          name: `${task.scheduleSummary} — ${task.prompt} (${task.lastStatus})`,
          data: `tasklist delete ${task.id}`,
        })),
      );
      return;
    }
    const separator = args.indexOf("|");
    if (separator < 1 || !args.slice(separator + 1).trim())
      throw new Error(t("mattermost.bot.use_task_schedule_prompt"));
    if (listScheduledTasks().length >= config.bot.taskLimit)
      throw new Error(t("mattermost.bot.scheduled_task_limit_reached"));
    const directory = this.requireProject();
    const model = createScheduledTaskModel(getStoredModel());
    const scheduleText = args.slice(0, separator).trim();
    const parsed = await parseTaskSchedule(scheduleText, directory, model);
    const base = {
      id: randomUUID(),
      projectId: settings.getCurrentProject()!.id,
      projectWorktree: directory,
      agent: getStoredAgent(),
      model,
      scheduleText,
      scheduleSummary: parsed.summary,
      timezone: parsed.timezone,
      prompt: args.slice(separator + 1).trim(),
      createdAt: new Date().toISOString(),
      nextRunAt: parsed.nextRunAt,
      lastRunAt: null,
      runCount: 0,
      lastStatus: "idle" as const,
      lastError: null,
    };
    const task: ScheduledTask =
      parsed.kind === "cron"
        ? { ...base, kind: "cron", cron: parsed.cron }
        : { ...base, kind: "once", runAt: parsed.runAt };
    await addScheduledTask(task);
    this.scheduler.registerTask(task);
    await this.messages.send(
      target,
      t("mattermost.bot.scheduled_next_run", { value1: parsed.summary, value2: parsed.nextRunAt }),
    );
  }

  private async prompt(post: MattermostPost, target: ReplyTarget): Promise<void> {
    let session = getCurrentSession();
    if (!session) {
      await this.command("new", target);
      session = this.requireSession();
    }
    let text = post.message;
    let audio = false;
    const files = [...this.attachedFiles];
    let total = 0;
    if ((post.file_ids?.length ?? 0) + files.length > 10)
      throw new Error(t("mattermost.bot.at_most_files_can_be_included_in_a_prompt"));
    for (const id of post.file_ids ?? []) {
      const info = await this.client.getFileInfo(id);
      if (
        !Number.isSafeInteger(info.size) ||
        info.size < 0 ||
        info.size > 20 * 1024 * 1024 ||
        total + info.size > 20 * 1024 * 1024
      )
        throw new Error(t("mattermost.bot.prompt_files_exceed_the_mib_limit"));
      const bytes = Buffer.from(await this.client.downloadFile(id, 20 * 1024 * 1024 - total));
      total += bytes.length;
      if (info.mime_type.startsWith("audio/")) {
        if (!isSttConfigured())
          throw new Error(
            t("mattermost.bot.configure_stt_api_url_and_stt_api_key_to_transcribe_aud"),
          );
        text += `\n${(await transcribeAudio(bytes, info.name)).text}`;
        audio = true;
      } else if (info.mime_type.startsWith("text/") || isTextFileName(info.name)) {
        text += `\n\nFile: ${info.name}\n${bytes.toString("utf8")}`;
      } else if (info.mime_type.startsWith("image/") || info.mime_type === "application/pdf") {
        files.push({
          type: "file",
          filename: info.name,
          mime: info.mime_type,
          url: toDataUri(bytes, info.mime_type),
        });
      } else if (isDocExtractorConfigured()) {
        text += `\n\nFile: ${info.name}\n${(await extractDocument(bytes, info.name, info.mime_type)).text}`;
      } else
        throw new Error(
          t("mattermost.bot.unsupported_file_type_configure_doc_extractor_url_for_d", {
            value1: info.mime_type,
          }),
        );
    }
    if (!text.trim() && !files.length) throw new Error(t("mattermost.bot.the_prompt_is_empty"));
    const prompt: Prompt = {
      text,
      files,
      target,
      audio,
      session,
      agent: getStoredAgent(),
      model: { ...getStoredModel() },
    };
    if (this.foreground.isBusy()) {
      if (settings.getPromptQueueMode() === "off")
        throw new Error(
          t("mattermost.bot.the_session_is_busy_enable_settings_queue_queue_or_use_"),
        );
      if (settings.getPromptQueueMode() === "steer") {
        const { error } = await opencodeClient.session.promptAsync({
          sessionID: session.id,
          directory: session.directory,
          delivery: "steer",
          parts: [...(text.trim() ? [{ type: "text" as const, text }] : []), ...files],
          agent: prompt.agent,
          model: { providerID: prompt.model.providerID, modelID: prompt.model.modelID },
        });
        if (error) throw error;
        this.attachedFiles = [];
        await this.messages.send(
          target,
          t("mattermost.bot.steering_message_submitted_to_the_running_session"),
        );
        return;
      }
      if (this.queued.length >= 5)
        throw new Error(t("mattermost.bot.the_prompt_queue_is_full_prompts"));
      this.queued.push(prompt);
      this.attachedFiles = [];
      await this.messages.send(
        target,
        t("mattermost.bot.queued_prompt", { value1: this.queued.length }),
      );
      return;
    }
    this.attachedFiles = [];
    await this.submit(prompt);
  }

  private async submit(prompt: Prompt): Promise<void> {
    settings.setReplyRootId(prompt.target.rootId);
    this.activity.begin(prompt.audio);
    this.foreground.markBusy(prompt.session.id, prompt.session.directory);
    this.subscribe(prompt.session.directory);
    try {
      const { error } = await opencodeClient.session.promptAsync({
        sessionID: prompt.session.id,
        directory: prompt.session.directory,
        parts: [
          ...(prompt.text.trim() ? [{ type: "text" as const, text: prompt.text }] : []),
          ...prompt.files,
        ],
        agent: prompt.agent,
        model: { providerID: prompt.model.providerID, modelID: prompt.model.modelID },
        ...(prompt.model.variant && prompt.model.variant !== "default"
          ? { variant: prompt.model.variant }
          : {}),
      });
      if (error) throw error;
    } catch (error) {
      this.foreground.markIdle(prompt.session.id);
      throw error;
    }
  }

  private async runOpenCodeCommand(input: string, target: ReplyTarget): Promise<void> {
    this.requireIdle();
    const session = this.requireSession();
    const [command, ...args] = input.split(/\s+/);
    if (!command) return;
    const available = [
      ...(await loadCommandCatalog(session.directory)),
      ...(await loadSkillsCatalog(session.directory)),
    ];
    if (!available.some((entry) => entry.name === command))
      throw new Error(t("mattermost.bot.unknown_command_use_help", { value1: command }));
    const model = getStoredModel();
    this.foreground.markBusy(session.id, session.directory);
    settings.setReplyRootId(target.rootId);
    this.activity.begin();
    this.subscribe(session.directory);
    // The API can wait for the whole run; keep the input queue free for abort and permissions.
    void opencodeClient.session
      .command({
        sessionID: session.id,
        directory: session.directory,
        command,
        arguments: args.join(" "),
        agent: getStoredAgent(),
        model: `${model.providerID}/${model.modelID}`,
      })
      .then(({ error }) => {
        if (error) throw error;
        this.deliverWork(() => this.activity.reconcile());
      })
      .catch(async (error: unknown) => {
        this.foreground.markIdle(session.id);
        this.report(error);
        await this.messages
          .send(target, t("mattermost.bot.opencode_command_failed_check_the_server_logs"))
          .catch((error) => this.report(error));
      });
  }

  private async idle(): Promise<void> {
    await this.updateDashboard();
    await this.scheduler.flushDeferredDeliveries();
    if (this.foreground.isBusy() || this.stopped) return;
    const next = this.queued.shift();
    if (next && next.session.id !== getCurrentSession()?.id) return;
    if (next)
      await this.submit(next).catch(async (error: unknown) => {
        this.report(error);
        await this.messages.send(
          next.target,
          t("mattermost.bot.the_queued_prompt_could_not_be_submitted_send_it_again_"),
        );
      });
  }

  private updateDashboard(): Promise<void> {
    this.dashboard = this.dashboard
      .catch((error: unknown) => this.report(error))
      .then(async () => {
        const id = settings.getPinnedMessageId();
        if (!settings.getPinnedDashboardEnabled()) {
          if (id) {
            await this.client.unpinPost(id);
            settings.clearPinnedMessageId();
          }
          return;
        }
        const session = getCurrentSession();
        const model = getStoredModel();
        const message = t("mattermost.bot.opencode_project_session", {
          value1: settings.getCurrentProject()?.worktree ?? "none",
          value2: session?.title ?? "none",
          value3: getStoredAgent(),
          value4: model.providerID,
          value5: model.modelID,
          value6: model.variant ?? "default",
          value7: this.foreground.isBusy() ? "Running" : "Idle",
        });
        if (id) await this.client.editPost(id, { message });
        else {
          const post = await this.client.createPost({
            channel_id: config.mattermost.channelId,
            message,
          });
          await this.client.pinPost(post.id);
          settings.setPinnedMessageId(post.id);
        }
      });
    return this.dashboard;
  }
}
