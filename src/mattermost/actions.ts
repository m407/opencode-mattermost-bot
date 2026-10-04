import { randomBytes } from "node:crypto";
import { logger } from "../utils/logger.js";

export interface MattermostActionResponse {
  update?: { message: string; props?: Record<string, unknown> };
  ephemeral_text?: string;
}

export interface MattermostActionRequest {
  user_id: string;
  channel_id: string;
  post_id: string;
  trigger_id?: string;
  context: { token: string; selected_option?: string };
}

export interface MattermostButton {
  name: string;
  data: string;
  options?: { text: string; value: string }[];
}

interface PendingAction {
  userId: string;
  channelId: string;
  postId: string;
  data: string;
  options?: string[];
  expiresAt: number;
}

/** Mount handle() behind an authenticated proxy accessible only to the Mattermost server. */
export class MattermostActions {
  private readonly pending = new Map<string, PendingAction>();

  constructor(
    private readonly callbackUrl: string,
    private readonly onAction: (
      data: string,
      request: MattermostActionRequest,
    ) => Promise<MattermostActionResponse>,
  ) {
    const url = new URL(callbackUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error("Mattermost action callback must be an HTTP(S) URL");
    }
  }

  createAttachment(
    target: { userId: string; channelId: string; postId: string },
    buttons: readonly MattermostButton[],
    text = "",
    ttlMs = 15 * 60_000,
  ): Record<string, unknown> {
    if (
      !target.userId ||
      !target.channelId ||
      !target.postId ||
      !Number.isFinite(ttlMs) ||
      ttlMs <= 0
    ) {
      throw new Error("Mattermost actions require a user, channel, post, and positive lifetime");
    }
    this.prune();
    if (this.pending.size + buttons.length > 2000)
      throw new Error("Too many pending Mattermost actions");
    const expiresAt = Date.now() + ttlMs;
    return {
      text,
      actions: buttons.map((button, index) => {
        const token = randomBytes(32).toString("hex");
        this.pending.set(token, {
          ...target,
          data: button.data,
          expiresAt,
          ...(button.options ? { options: button.options.map((option) => option.value) } : {}),
        });
        return {
          id: `action${index}`,
          name: button.name,
          type: button.options ? "select" : "button",
          ...(button.options ? { options: button.options } : {}),
          integration: { url: this.callbackUrl, context: { token } },
        };
      }),
    };
  }

  private prune(): void {
    for (const [token, action] of this.pending) {
      if (action.expiresAt <= Date.now()) this.pending.delete(token);
    }
  }

  invalidatePost(postId: string): void {
    for (const [token, action] of this.pending) {
      if (action.postId === postId) this.pending.delete(token);
    }
  }

  async handle(body: unknown): Promise<{ status: number; body: MattermostActionResponse }> {
    this.prune();
    if (!body || typeof body !== "object") return { status: 400, body: {} };
    const request = body as MattermostActionRequest;
    const token = request.context?.token;
    if (typeof token !== "string") return { status: 400, body: {} };
    const action = this.pending.get(token);
    if (
      !action ||
      request.user_id !== action.userId ||
      request.channel_id !== action.channelId ||
      request.post_id !== action.postId
    ) {
      return { status: 403, body: {} };
    }
    if (action.options && !action.options.includes(request.context.selected_option ?? "")) {
      return { status: 400, body: {} };
    }
    // Consume before awaiting: two simultaneous deliveries must not execute twice.
    this.pending.delete(token);
    try {
      return { status: 200, body: await this.onAction(action.data, request) };
    } catch {
      logger.error("[Mattermost] Action handler failed");
      return { status: 500, body: {} };
    }
  }
}
