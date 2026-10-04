import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MattermostPost } from "../../src/mattermost/client.js";
import { MattermostClient } from "../../src/mattermost/client.js";
import { MattermostBot } from "../../src/mattermost/bot.js";
import { config } from "../../src/config.js";
import * as settings from "../../src/app/stores/settings-store.js";
import { opencodeClient, opencodeV2Client } from "../../src/opencode/client.js";
import { subscribeToEvents } from "../../src/opencode/events.js";
import type { EventEnvelope } from "../../src/opencode/events.js";

vi.mock("../../src/opencode/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/opencode/client.js")>()),
  opencodeServerVersion: "v2",
  opencodeV2Client: { session: { promptAsync: vi.fn() } },
}));
vi.mock("../../src/opencode/events.js", () => ({
  subscribeToEvents: vi.fn().mockResolvedValue(undefined),
  stopEventListening: vi.fn(),
}));
vi.mock("../../src/mattermost/events.js", () => ({
  MattermostEvents: class {
    start = vi.fn();
    stop = vi.fn();
  },
}));
vi.mock("../../src/app/services/recent-sessions-service.js", () => ({
  resolveSessionParentChain: vi.fn().mockResolvedValue(null),
  loadRecentSessions: vi.fn().mockResolvedValue([]),
}));

const root = "r".repeat(26);
const channel = config.mattermost.channelId;
const session = { id: "session-1", title: "Task", directory: "/project" };
function post(message: string, extra: Partial<MattermostPost> = {}): MattermostPost {
  return {
    id: "p".repeat(26),
    user_id: config.mattermost.allowedUserId,
    channel_id: channel,
    root_id: root,
    message,
    type: "",
    props: {},
    create_at: Date.now(),
    update_at: Date.now(),
    delete_at: 0,
    ...extra,
  };
}
function event(type: string, properties: unknown): EventEnvelope {
  return { directory: "/project", event: { type, properties } } as EventEnvelope;
}

describe("Mattermost application", () => {
  let bot: MattermostBot;
  let client: MattermostClient;
  beforeEach(() => {
    vi.mocked(subscribeToEvents).mockResolvedValue(undefined);
    settings.__resetSettingsForTests();
    settings.setCurrentProject({ id: "project", name: "Project", worktree: "/project" });
    settings.setCurrentSession(session);
    settings.setPinnedDashboardEnabled(false);
    settings.setShowAssistantRunFooter(false);
    settings.setReplyRootId(root);
    client = new MattermostClient("http://mattermost.test", "secret");
    let index = 0;
    vi.spyOn(client, "createPost").mockImplementation(async (input) =>
      post(input.message, { id: `result-${++index}`, ...input }),
    );
    vi.spyOn(client, "editPost").mockResolvedValue(post("edited"));
    vi.spyOn(client, "deletePost").mockResolvedValue(undefined);
    vi.spyOn(opencodeClient.session, "promptAsync").mockResolvedValue({ data: undefined } as never);
    vi.spyOn(opencodeClient.session, "status").mockResolvedValue({ data: {} } as never);
    vi.spyOn(opencodeClient.session, "messages").mockResolvedValue({ data: [] } as never);
    vi.spyOn(opencodeClient.permission, "list").mockResolvedValue({ data: [] } as never);
    vi.spyOn(opencodeClient.question, "list").mockResolvedValue({ data: [] } as never);
    bot = new MattermostBot(client);
  });
  afterEach(async () => {
    await bot.stop();
    settings.__resetSettingsForTests();
  });
  async function accept(message: MattermostPost): Promise<void> {
    await bot.accept({ kind: "posted", post: message, threadId: message.root_id || message.id });
  }

  it("routes prompts to the selected session and streams a final reply into its thread once", async () => {
    await accept(post("Fix the tests"));
    expect(opencodeClient.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: session.id,
        directory: session.directory,
        parts: [{ type: "text", text: "Fix the tests" }],
      }),
    );
    vi.mocked(opencodeClient.session.messages).mockResolvedValue({
      data: [
        {
          info: {
            id: "answer-1",
            role: "assistant",
            time: { created: Date.now(), completed: Date.now() },
          },
          parts: [{ type: "text", text: "Tests fixed" }],
        },
      ],
    } as never);
    await bot.activity.event(event("session.idle", { sessionID: session.id }));
    await bot.activity.event(event("session.idle", { sessionID: session.id }));
    expect(client.createPost).toHaveBeenCalledTimes(1);
    expect(client.createPost).toHaveBeenCalledWith({
      channel_id: channel,
      root_id: root,
      message: "Tests fixed",
    });
    expect(settings.getDeliveredAssistantIds()).toContain("answer-1");
    expect(bot.foreground.isBusy()).toBe(false);
  });
  it("serializes simultaneous reconnect reconciliation without duplicate final posts", async () => {
    vi.mocked(opencodeClient.session.messages).mockResolvedValue({
      data: [
        {
          info: {
            id: "raced-answer",
            role: "assistant",
            time: { created: Date.now(), completed: Date.now() },
          },
          parts: [{ type: "text", text: "One answer" }],
        },
      ],
    } as never);
    await Promise.all([bot.activity.reconcile(), bot.activity.reconcile()]);
    expect(client.createPost).toHaveBeenCalledTimes(1);
  });
  it("continues processing abort while a custom OpenCode command is running", async () => {
    vi.spyOn(opencodeClient.command, "list").mockResolvedValue({
      data: [{ name: "review", source: "command" }],
    } as never);
    let complete: (value: never) => void = () => undefined;
    vi.spyOn(opencodeClient.session, "command").mockImplementation(
      () =>
        new Promise<never>((resolve) => {
          complete = resolve;
        }),
    );
    const abort = vi
      .spyOn(opencodeClient.session, "abort")
      .mockResolvedValue({ data: true } as never);
    await accept(post("!review"));
    await accept(post("!abort"));
    expect(abort).toHaveBeenCalledTimes(1);
    complete({ data: undefined } as never);
  });
  it("ignores other users, channels and edits, and does not execute recovered old prompts", async () => {
    await accept(post("bad", { user_id: "other" }));
    await accept(post("bad", { channel_id: "other" }));
    await bot.accept({ kind: "post_edited", post: post("bad"), threadId: root });
    await accept(post("old", { create_at: Date.now() - 120000 }));
    expect(opencodeClient.session.promptAsync).not.toHaveBeenCalled();
    expect(client.createPost).toHaveBeenCalledTimes(1);
  });
  it("queues a prompt and ignores stale idle events while the next run is busy", async () => {
    settings.setPromptQueueMode("queue");
    await accept(post("first"));
    await accept(post("second"));
    expect(opencodeClient.session.promptAsync).toHaveBeenCalledTimes(1);
    await bot.activity.event(
      event("session.status", { sessionID: session.id, status: { type: "busy" } }),
    );
    await bot.activity.event(event("session.idle", { sessionID: session.id }));
    expect(opencodeClient.session.promptAsync).toHaveBeenCalledTimes(2);
    vi.mocked(opencodeClient.session.status).mockResolvedValue({
      data: { [session.id]: { type: "busy" } },
    } as never);
    await bot.activity.event(event("session.idle", { sessionID: session.id }));
    expect(bot.foreground.isBusy()).toBe(true);
  });
  it("keeps an unanswered permission retryable after an API failure and binds it to its thread", async () => {
    const reply = vi
      .spyOn(opencodeClient.permission, "reply")
      .mockResolvedValueOnce({ error: new Error("temporary") } as never)
      .mockResolvedValue({ data: true } as never);
    await bot.activity.event(
      event("permission.asked", {
        id: "permission-1",
        sessionID: session.id,
        permission: "bash",
        patterns: ["npm test"],
      }),
    );
    await expect(
      bot.command("permission permission-1 once", { channelId: channel, rootId: "other" }),
    ).rejects.toThrow("thread");
    expect(reply).not.toHaveBeenCalled();
    await expect(
      bot.command("permission permission-1 once", { channelId: channel, rootId: root }),
    ).rejects.toThrow("temporary");
    await bot.command("permission permission-1 once", { channelId: channel, rootId: root });
    expect(reply).toHaveBeenCalledTimes(2);
    await expect(
      bot.command("permission permission-1 always", { channelId: channel, rootId: root }),
    ).rejects.toThrow("pending");
  });
  it("validates multiple questions and maps option labels to server values", async () => {
    const reply = vi
      .spyOn(opencodeClient.question, "reply")
      .mockResolvedValue({ data: true } as never);
    await bot.activity.event(
      event("question.asked", {
        id: "q-1",
        sessionID: session.id,
        questions: [
          {
            header: "Mode",
            question: "Pick",
            options: [{ label: "Safe", description: "", value: "safe-id" }],
            custom: false,
          },
          { header: "Text", question: "Explain", options: [], custom: true },
        ],
      }),
    );
    await expect(
      bot.command('answer q-1 [["unsafe"],["notes"]]', { channelId: channel, rootId: root }),
    ).rejects.toThrow("Custom");
    await bot.command('answer q-1 [["Safe"],["notes"]]', { channelId: channel, rootId: root });
    expect(reply).toHaveBeenCalledWith({
      requestID: "q-1",
      directory: "/project",
      answers: [["safe-id"], ["notes"]],
    });
  });
  it("reconciles pending interactions and does not replay already delivered responses", async () => {
    settings.markAssistantDelivered("old-answer");
    vi.mocked(opencodeClient.permission.list).mockResolvedValue({
      data: [{ id: "pending", sessionID: session.id, permission: "edit", patterns: ["a.ts"] }],
    } as never);
    vi.mocked(opencodeClient.session.messages).mockResolvedValue({
      data: [
        {
          info: {
            id: "old-answer",
            role: "assistant",
            time: { created: Date.now(), completed: Date.now() },
          },
          parts: [{ type: "text", text: "already sent" }],
        },
      ],
    } as never);
    await bot.activity.reconcile();
    expect(client.createPost).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.createPost).mock.calls[0]?.[0].message).toContain("permission pending");
  });
  it("aborts the running task and discards queued input", async () => {
    settings.setPromptQueueMode("queue");
    const abort = vi
      .spyOn(opencodeClient.session, "abort")
      .mockResolvedValue({ data: true } as never);
    await accept(post("first"));
    await accept(post("second"));
    await bot.command("abort", { channelId: channel, rootId: root });
    await bot.activity.event(event("session.idle", { sessionID: session.id }));
    expect(abort).toHaveBeenCalledWith({ sessionID: session.id, directory: "/project" });
    expect(opencodeClient.session.promptAsync).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized file metadata before downloading", async () => {
    vi.spyOn(client, "getFileInfo").mockResolvedValue({
      id: "file",
      name: "large.pdf",
      size: 21 * 1024 * 1024,
      mime_type: "application/pdf",
    });
    const download = vi.spyOn(client, "downloadFile");
    await accept(post("Read", { file_ids: ["file"] }));
    expect(download).not.toHaveBeenCalled();
    expect(opencodeClient.session.promptAsync).not.toHaveBeenCalled();
  });
  it("sends text files as text alongside the user's prompt", async () => {
    vi.spyOn(client, "getFileInfo").mockResolvedValue({
      id: "file",
      name: "code.ts",
      size: 3,
      mime_type: "text/plain",
    });
    vi.spyOn(client, "downloadFile").mockResolvedValue(Buffer.from("abc"));
    await accept(post("Read", { file_ids: ["file"] }));
    expect(opencodeClient.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ parts: [{ type: "text", text: "Read\n\nFile: code.ts\nabc" }] }),
    );
  });
  it("steers a busy V2 session through its server inbox", async () => {
    const version = config.opencode.serverVersion;
    config.opencode.serverVersion = "v2";
    settings.setPromptQueueMode("steer");
    const steer = vi
      .spyOn(opencodeV2Client.session, "promptAsync")
      .mockResolvedValue({ data: { inboxID: "inbox-1" } } as never);
    await accept(post("first"));
    await accept(post("change direction"));
    config.opencode.serverVersion = version;
    expect(steer).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: session.id,
        delivery: "steer",
        parts: [{ type: "text", text: "change direction" }],
      }),
    );
    expect(opencodeClient.session.promptAsync).toHaveBeenCalledTimes(1);
  });
});
