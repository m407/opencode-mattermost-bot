import { t } from "../i18n/index.js";
import { config } from "../config.js";
import { isScheduledTaskSessionIgnored } from "../app/services/scheduled-task-session-ignore-service.js";
import type { EventEnvelope } from "../opencode/events.js";
import { opencodeClient } from "../opencode/client.js";
import { resolveSessionParentChain } from "../app/services/recent-sessions-service.js";
import { getCurrentSession } from "../app/services/session-service.js";
import * as settings from "../app/stores/settings-store.js";
import { getStoredModel } from "../app/services/model-selection-service.js";
import { getStoredAgent } from "../app/services/agent-selection-service.js";
import { synthesizeSpeech, isTtsConfigured } from "../app/services/tts-service.js";
import { formatAssistantRunFooter } from "../app/formatters/assistant-run-footer-formatter.js";
import { isRecord } from "../utils/type-guards.js";
import type { ForegroundSessionState } from "../app/managers/foreground-session-state-manager.js";
import type { MattermostInteractions, PendingPermission, PendingQuestion } from "./interactions.js";
import { MattermostMessages, MattermostStream, type ReplyTarget } from "./messages.js";

function formatReply(text: string): string {
  return config.bot.messageFormatMode === "raw"
    ? text.replace(/([\\`*_{}\[\]<>()#+\-.!|>~])/g, "\\$1")
    : text;
}

interface TrackedMessage {
  parts: Map<string, string>;
  stream: MattermostStream | undefined;
  offset: number;
}

export class MattermostActivity {
  private messagesById = new Map<string, TrackedMessage>();
  private assistantIds = new Set<string>();
  private tools = new Map<string, { id: string; started: number; updated: number }>();
  private diffSent = new Set<string>();
  private descendants = new Set<string>();
  private started = Date.now();
  private cancelled = false;
  private autoSpeech = false;
  private generation = 0;
  private processing: Promise<void> = Promise.resolve();
  private awaitingRun = false;
  private background = new Set<string>();
  private backgroundRequests = new Set<string>();

  constructor(
    private readonly messages: MattermostMessages,
    private readonly interactions: MattermostInteractions,
    private readonly foreground: ForegroundSessionState,
    private readonly target: () => ReplyTarget,
    private readonly report: (error: unknown) => void,
    private readonly onIdle: () => Promise<void>,
  ) {}

  private serialize(work: () => Promise<void>): Promise<void> {
    const next = this.processing.then(work);
    this.processing = next.catch(() => undefined);
    return next;
  }

  event(envelope: EventEnvelope): Promise<void> {
    return this.serialize(() => this.processEvent(envelope));
  }

  reconcile(): Promise<void> {
    return this.serialize(() => this.reconcileState());
  }

  async accepts(sessionId: string, directory: string): Promise<boolean> {
    const session = getCurrentSession();
    if (!session || session.directory !== directory) return false;
    if (session.id === sessionId || this.descendants.has(sessionId)) return true;
    const chain = await resolveSessionParentChain(sessionId, directory, new Set([session.id]));
    if (!chain || getCurrentSession()?.id !== session.id) return false;
    for (const link of chain.links) this.descendants.add(link.child);
    return true;
  }

  begin(autoSpeech = false): void {
    this.generation++;
    this.awaitingRun = true;
    this.started = Date.now();
    this.cancelled = false;
    this.autoSpeech = autoSpeech;
  }

  async reset(): Promise<void> {
    this.generation++;
    this.awaitingRun = false;
    this.cancelled = true;
    await this.processing;
    await this.sealText();
    this.messagesById.clear();
    this.assistantIds.clear();
    this.tools.clear();
    this.descendants.clear();
    this.diffSent.clear();
  }

  private record(id: string): TrackedMessage {
    let value = this.messagesById.get(id);
    if (!value) {
      if (this.messagesById.size >= 1000) {
        const oldest = this.messagesById.keys().next().value;
        if (oldest) {
          this.messagesById.delete(oldest);
          this.assistantIds.delete(oldest);
        }
      }
      value = { parts: new Map(), stream: undefined, offset: 0 };
      this.messagesById.set(id, value);
    }
    return value;
  }

  private render(id: string): void {
    if (
      this.cancelled ||
      !this.assistantIds.has(id) ||
      settings.getDeliveredAssistantIds().includes(id)
    )
      return;
    const record = this.record(id);
    const text = [...record.parts.values()].join("\n").slice(record.offset);
    if (!text) return;
    record.stream ??= new MattermostStream(this.messages, this.target(), this.report, formatReply);
    record.stream.update(text);
  }

  async sealText(): Promise<void> {
    for (const record of this.messagesById.values()) {
      if (record.stream) {
        await record.stream.finish();
        record.stream = undefined;
        record.offset = [...record.parts.values()].join("\n").length;
      }
    }
  }

  private async processEvent({ directory, event }: EventEnvelope): Promise<void> {
    const properties: unknown = event.properties;
    if (!isRecord(properties)) return;
    const part = isRecord(properties.part) ? properties.part : undefined;
    const info = isRecord(properties.info) ? properties.info : undefined;
    const sessionId = properties.sessionID ?? part?.sessionID ?? info?.sessionID;
    if (typeof sessionId !== "string") return;
    if (!(await this.accepts(sessionId, directory))) {
      if (
        !config.bot.trackBackgroundSessions ||
        directory !== settings.getCurrentProject()?.worktree ||
        isScheduledTaskSessionIgnored(sessionId)
      )
        return;
      const status = isRecord(properties.status) ? properties.status.type : undefined;
      if (status === "busy" || status === "retry") {
        if (this.background.size < 1000) this.background.add(sessionId);
      }
      const request =
        ["permission.asked", "question.asked"].includes(event.type) &&
        typeof properties.id === "string"
          ? properties.id
          : undefined;
      const completed =
        (status === "idle" || event.type === "session.idle") && this.background.delete(sessionId);
      if (completed || (request && !this.backgroundRequests.has(request))) {
        const { data, error } = await opencodeClient.session.get({
          sessionID: sessionId,
          directory,
        });
        if (error || !data || data.parentID) return;
        if (request) {
          if (this.backgroundRequests.size >= 1000) this.backgroundRequests.clear();
          this.backgroundRequests.add(request);
        }
        const command = `follow ${encodeURIComponent(directory)} ${sessionId}`;
        await this.messages.card(
          { channelId: this.target().channelId },
          `**${data.title}** — ${completed ? "background task finished" : "needs your input"}\n\`!${command}\``,
          [{ name: t("mattermost.activity.follow_session"), data: command }],
        );
      }
      return;
    }
    const primary = sessionId === getCurrentSession()?.id;
    if (event.type === "permission.asked") {
      await this.sealText();
      await this.interactions.show(
        { kind: "permission", request: properties as unknown as PendingPermission },
        directory,
        this.target(),
      );
    } else if (event.type === "question.asked") {
      await this.sealText();
      await this.interactions.show(
        { kind: "question", request: properties as unknown as PendingQuestion },
        directory,
        this.target(),
      );
    } else if (
      ["permission.replied", "question.replied", "question.rejected"].includes(event.type)
    ) {
      if (typeof properties.requestID === "string")
        await this.interactions.settle(
          properties.requestID,
          t("mattermost.activity.settled_in_opencode"),
        );
    } else if (
      event.type === "message.updated" &&
      primary &&
      info?.role === "assistant" &&
      typeof info.id === "string"
    ) {
      this.assistantIds.add(info.id);
      this.render(info.id);
    } else if (
      event.type === "message.part.updated" &&
      part &&
      typeof part.id === "string" &&
      typeof part.messageID === "string"
    ) {
      if (part.type === "text" && !part.ignored && typeof part.text === "string" && primary) {
        this.record(part.messageID).parts.set(part.id, part.text);
        this.render(part.messageID);
      } else if (
        part.type === "reasoning" &&
        settings.getShowThinkingContent() &&
        typeof part.text === "string"
      ) {
        await this.tool(part.id, "Thinking", part.text, "running");
      } else if (part.type === "tool" && isRecord(part.state)) {
        await this.sealText();
        const label = typeof part.tool === "string" ? part.tool : "Tool";
        const state = part.state;
        const title = typeof state.title === "string" ? state.title : "";
        const input = isRecord(state.input) ? state.input : {};
        const detail =
          title ||
          [input.filePath, input.path, input.command, input.description].find(
            (x) => typeof x === "string",
          ) ||
          "";
        await this.tool(
          part.id,
          label,
          String(detail).slice(0, label === "bash" ? config.bot.bashToolDisplayMaxLength : 2000),
          String(state.status),
        );
        if (
          state.status === "completed" &&
          settings.getSendDiffFileAttachments() &&
          !this.diffSent.has(part.id)
        ) {
          const metadata = isRecord(state.metadata) ? state.metadata : {};
          const diff = typeof metadata.diff === "string" ? metadata.diff : undefined;
          if (diff && Buffer.byteLength(diff) <= 1024 * 1024) {
            const target = this.target();
            await this.messages.client.sendFile(
              {
                channel_id: target.channelId,
                message: `Changes: ${detail}`,
                ...(target.rootId ? { root_id: target.rootId } : {}),
              },
              "changes.diff",
              Buffer.from(diff),
              "text/x-diff",
            );
            if (this.diffSent.size >= 1000)
              this.diffSent.delete(this.diffSent.values().next().value!);
            this.diffSent.add(part.id);
          }
        }
      }
    } else if (
      event.type === "message.part.delta" &&
      primary &&
      properties.field === "text" &&
      typeof properties.messageID === "string" &&
      typeof properties.partID === "string" &&
      typeof properties.delta === "string"
    ) {
      const record = this.record(properties.messageID);
      record.parts.set(
        properties.partID,
        (record.parts.get(properties.partID) ?? "") + properties.delta,
      );
      this.render(properties.messageID);
    } else if (event.type === "session.error" && primary) {
      this.cancelled = true;
      await this.messages.send(
        this.target(),
        t("mattermost.activity.opencode_could_not_finish_the_task_check_the_server_log"),
      );
      await this.finish(directory, sessionId);
    } else if (event.type === "session.status" && primary && isRecord(properties.status)) {
      if (properties.status.type === "busy" || properties.status.type === "retry") {
        if (!this.foreground.isBusy()) this.begin();
        this.awaitingRun = false;
        this.foreground.markBusy(sessionId, directory);
      } else if (properties.status.type === "idle") await this.finish(directory, sessionId);
    } else if (event.type === "session.idle" && primary) await this.finish(directory, sessionId);
  }

  private async tool(key: string, label: string, detail: string, status: string): Promise<void> {
    const compact = settings.getCompactOutputMode();
    const id = compact ? "progress" : key;
    const previous = this.tools.get(id);
    const done = status === "completed" || status === "error";
    const text = `${done ? (status === "error" ? "❌" : "✅") : "⏳"} **${label}**${detail ? ` — ${detail}` : ""}${done && previous ? ` · ${Math.round((Date.now() - previous.started) / 1000)}s` : ""}`;
    if (previous) {
      if (!done && Date.now() - previous.updated < 1000) return;
      await this.messages.client.editPost(previous.id, { message: text });
      previous.updated = Date.now();
    } else {
      if (this.tools.size >= 1000) this.tools.delete(this.tools.keys().next().value!);
      this.tools.set(id, {
        id: (await this.messages.send(this.target(), text))[0]!,
        started: Date.now(),
        updated: Date.now(),
      });
    }
  }

  private async reconcileState(): Promise<void> {
    const session = getCurrentSession();
    if (!session) return;
    await this.interactions.reconcile(session.directory, this.target(), (id) =>
      this.accepts(id, session.directory),
    );
    const status = await opencodeClient.session.status({ directory: session.directory });
    if (status.error) throw status.error;
    if (status.data?.[session.id]?.type === "busy" || status.data?.[session.id]?.type === "retry") {
      if (!this.foreground.isBusy()) this.begin();
      this.awaitingRun = false;
      this.foreground.markBusy(session.id, session.directory);
    } else await this.finish(session.directory, session.id);
  }

  async baseline(directory: string, sessionId: string): Promise<void> {
    const { data, error } = await opencodeClient.session.messages({
      directory,
      sessionID: sessionId,
      limit: 100,
    });
    if (error) throw error;
    for (const message of data ?? [])
      if (message.info.role === "assistant" && message.info.time.completed) {
        settings.markAssistantDelivered(message.info.id);
      }
  }

  private async finish(directory: string, sessionId: string): Promise<void> {
    const generation = this.generation;
    const target = this.target();
    // The event translator emits both idle variants. A stale idle event must not advance the next run.
    const status = await opencodeClient.session.status({ directory });
    if (status.error) throw status.error;
    if (["busy", "retry"].includes(status.data?.[sessionId]?.type ?? "")) return;
    const wasBusy = this.foreground.isBusy();
    const { data, error } = await opencodeClient.session.messages({
      directory,
      sessionID: sessionId,
      limit: 100,
    });
    if (error) throw error;
    if (generation !== this.generation || getCurrentSession()?.id !== sessionId) return;
    if (
      this.awaitingRun &&
      Date.now() - this.started < 10000 &&
      !(data ?? []).some(
        (message) =>
          message.info.role === "assistant" && (message.info.time.completed ?? 0) >= this.started,
      )
    )
      return;
    this.awaitingRun = false;
    let delivered = false;
    for (const message of (data ?? []).sort((a, b) => a.info.time.created - b.info.time.created)) {
      if (
        message.info.role !== "assistant" ||
        !message.info.time.completed ||
        settings.getDeliveredAssistantIds().includes(message.info.id)
      )
        continue;
      const text = message.parts
        .filter((p) => p.type === "text" && !p.ignored)
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("\n");
      if (text && !this.cancelled) {
        const record = this.record(message.info.id);
        const remaining = text.slice(record.offset);
        if (record.stream) await record.stream.finish(remaining);
        else if (remaining) await this.messages.send(target, formatReply(remaining));
        delivered = true;
        if (
          !this.cancelled &&
          isTtsConfigured() &&
          (settings.getTtsMode() === "all" || (settings.getTtsMode() === "auto" && this.autoSpeech))
        ) {
          try {
            const speech = await synthesizeSpeech(text);
            await this.messages.client.sendFile(
              {
                channel_id: target.channelId,
                message: "Audio response",
                ...(target.rootId ? { root_id: target.rootId } : {}),
              },
              speech.filename,
              speech.buffer,
              speech.mimeType,
            );
          } catch (error) {
            this.report(error);
          }
        }
      }
      settings.markAssistantDelivered(message.info.id);
      this.messagesById.delete(message.info.id);
      this.assistantIds.delete(message.info.id);
    }
    if (delivered && !this.cancelled && settings.getShowAssistantRunFooter()) {
      const model = getStoredModel();
      await this.messages.send(
        target,
        formatAssistantRunFooter({
          agent: getStoredAgent(),
          providerID: model.providerID,
          modelID: model.modelID,
          elapsedMs: Date.now() - this.started,
        }),
      );
    }
    if (settings.getDeleteCompactProgressOnFinish() && this.tools.has("progress")) {
      await this.messages.client.deletePost(this.tools.get("progress")!.id);
      this.tools.delete("progress");
    }
    if (generation !== this.generation) return;
    this.foreground.markIdle(sessionId);
    await this.interactions.reconcile(directory, this.target(), (id) =>
      this.accepts(id, directory),
    );
    await settings.flushSettings();
    if (wasBusy) await this.onIdle();
  }
}
