import WebSocket from "ws";
import { logger } from "../utils/logger.js";
import { MattermostClient, type MattermostPost } from "./client.js";

export interface MattermostPostEvent {
  kind: "posted" | "post_edited";
  post: MattermostPost;
  /** root_id is empty for a root post; replies always retain the same thread key. */
  threadId: string;
}

export interface MattermostEventOptions {
  allowedUserId: string;
  allowedChannelIds: readonly string[];
  onPost(event: MattermostPostEvent): Promise<void>;
  /** Called on every hello, including reconnects. Use REST to reconcile missed events. */
  onConnected?(): Promise<void>;
  onError?(error: unknown): void;
}

export function parsePostEvent(
  raw: string,
  botId: string,
  options: Pick<MattermostEventOptions, "allowedUserId" | "allowedChannelIds">,
): MattermostPostEvent | null {
  const event: unknown = JSON.parse(raw);
  if (!event || typeof event !== "object") return null;
  const { event: kind, data } = event as { event?: unknown; data?: { post?: unknown } };
  if ((kind !== "posted" && kind !== "post_edited") || typeof data?.post !== "string") return null;
  const post: unknown = JSON.parse(data.post);
  if (!post || typeof post !== "object") return null;
  const p = post as MattermostPost;
  if (
    typeof p.id !== "string" ||
    typeof p.channel_id !== "string" ||
    typeof p.user_id !== "string" ||
    typeof p.message !== "string" ||
    typeof p.root_id !== "string"
  )
    return null;
  if (
    p.user_id === botId ||
    p.user_id !== options.allowedUserId ||
    !options.allowedChannelIds.includes(p.channel_id) ||
    p.delete_at ||
    p.type
  )
    return null;
  return { kind, post: p, threadId: p.root_id || p.id };
}

/** One authenticated socket, bounded duplicate suppression, serialized delivery, explicit shutdown. */
export class MattermostEvents {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private generation = 0;
  private botId = "";
  private retryDelay = 1000;
  private delivery = Promise.resolve();
  private readonly seen = new Set<string>();

  constructor(
    private readonly client: MattermostClient,
    private readonly options: MattermostEventOptions,
  ) {
    if (!options.allowedUserId || !options.allowedChannelIds.length) {
      throw new Error("Mattermost events require an allowed user and at least one allowed channel");
    }
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    const generation = ++this.generation;
    try {
      const bot = await this.client.getMe();
      if (!this.stopped && generation === this.generation) {
        this.botId = bot.id;
        this.connect();
      }
    } catch (error) {
      if (generation === this.generation) this.stopped = true;
      throw error;
    }
  }

  private report(error: unknown): void {
    logger.warn("[Mattermost] Event transport failed");
    try {
      this.options.onError?.(error);
    } catch {
      logger.warn("[Mattermost] Error handler failed");
    }
  }

  private enqueue(work: () => Promise<void>, generation: number): void {
    this.delivery = this.delivery
      .then(async () => {
        if (!this.stopped && this.generation === generation) await work();
      })
      .catch((error: unknown) => this.report(error));
  }

  private connect(): void {
    if (this.stopped) return;
    const generation = this.generation;
    const socket = new WebSocket(this.client.websocketUrl, {
      headers: this.client.authenticationHeaders(),
      handshakeTimeout: 10_000,
      maxPayload: 4 * 1024 * 1024,
      followRedirects: false,
    });
    this.socket = socket;
    let alive = true;
    let ready = false;
    socket.on("pong", () => {
      alive = true;
    });
    socket.on("open", () => {
      this.heartbeatTimer = setInterval(() => {
        if (!alive || !ready) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, 30_000);
    });
    socket.on("message", (raw) => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const text = raw.toString();
        const envelope = JSON.parse(text) as { event?: string };
        if (envelope.event === "hello" && !ready) {
          ready = true;
          this.retryDelay = 1000;
          this.enqueue(async () => {
            await this.options.onConnected?.();
          }, generation);
          return;
        }
        if (!ready) return;
        const event = parsePostEvent(text, this.botId, this.options);
        if (!event) return;
        const key = `${event.kind}:${event.post.id}:${event.post.update_at}`;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        if (this.seen.size > 2000) {
          const first = this.seen.values().next().value;
          if (first !== undefined) this.seen.delete(first);
        }
        this.enqueue(() => this.options.onPost(event), generation);
      } catch (error) {
        this.report(error);
      }
    });
    socket.on("error", (error) => this.report(error));
    socket.on("unexpected-response", (_request, response) => {
      response.resume();
      if (response.statusCode === 401 || response.statusCode === 403) {
        this.report(new Error("Mattermost WebSocket authentication rejected"));
        void this.stop();
      } else {
        socket.terminate();
      }
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      if (this.stopped) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    ++this.generation;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.terminate();
    this.seen.clear();
    // Await already-running work; queued work is skipped by the generation check.
    await this.delivery;
  }
}
