import type { MattermostClient } from "./client.js";
import type { MattermostActions, MattermostButton } from "./actions.js";

export interface ReplyTarget {
  channelId: string;
  rootId?: string;
}

/** Leave room for Markdown and split without cutting a Unicode surrogate pair. */
export function splitMessage(text: string, limit = 14_000): string[] {
  if (!Number.isSafeInteger(limit) || limit < 2)
    throw new Error("Message limit must be at least 2");
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let end = remaining.lastIndexOf("\n", limit);
    if (end < limit / 2) end = limit;
    const last = remaining.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push(remaining);
  return chunks.length ? chunks : ["…"];
}

export class MattermostMessages {
  constructor(
    readonly client: MattermostClient,
    private readonly userId: string,
    readonly actions?: MattermostActions,
  ) {}

  async send(target: ReplyTarget, text: string): Promise<string[]> {
    const ids: string[] = [];
    for (const message of splitMessage(text)) {
      const post = await this.client.createPost({
        channel_id: target.channelId,
        message,
        ...(target.rootId ? { root_id: target.rootId } : {}),
      });
      ids.push(post.id);
    }
    return ids;
  }

  async card(
    target: ReplyTarget,
    text: string,
    buttons: readonly MattermostButton[],
  ): Promise<string> {
    const post = { id: (await this.send(target, text))[0]! };
    if (this.actions && buttons.length) {
      const attachment = this.actions.createAttachment(
        { userId: this.userId, channelId: target.channelId, postId: post.id },
        buttons,
      );
      await this.client.editPost(post.id, { props: { attachments: [attachment] } });
    }
    return post.id;
  }

  async closeCard(postId: string, text: string): Promise<void> {
    this.actions?.invalidatePost(postId);
    await this.client.editPost(postId, {
      message: splitMessage(text)[0]!,
      props: { attachments: [] },
    });
  }
}

/** Coalesce stream deltas, retaining only the latest text while a request is in flight. */
export class MattermostStream {
  private ids: string[] = [];
  private sent: string[] = [];
  private pending = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly messages: MattermostMessages,
    private readonly target: ReplyTarget,
    private readonly report: (error: unknown) => void,
    private readonly format: (text: string) => string = (text) => text,
  ) {}

  update(text: string): void {
    if (this.closed) return;
    this.pending = text;
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.writing = this.writing.then(() => this.write()).catch(this.report);
      }, 1000);
  }

  private async write(): Promise<void> {
    const chunks = splitMessage(this.format(this.pending));
    for (let index = 0; index < chunks.length; index++) {
      const text = chunks[index]!;
      if (text === this.sent[index]) continue;
      const id = this.ids[index];
      if (id) await this.messages.client.editPost(id, { message: text });
      else this.ids[index] = (await this.messages.send(this.target, text))[0]!;
      this.sent[index] = text;
    }
    for (let index = chunks.length; index < this.ids.length; index++) {
      await this.messages.client.deletePost(this.ids[index]!);
    }
    this.ids.length = chunks.length;
    this.sent.length = chunks.length;
  }

  async finish(text?: string): Promise<void> {
    if (text !== undefined) this.pending = text;
    if (this.timer) clearTimeout(this.timer);
    this.closed = true;
    await this.writing;
    if (this.pending) await this.write();
  }
}
