export interface MattermostUser {
  id: string;
  username: string;
  first_name?: string;
  last_name?: string;
}

export interface MattermostPost {
  id: string;
  channel_id: string;
  user_id: string;
  message: string;
  root_id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  type: string;
  file_ids?: string[];
  props: Record<string, unknown>;
}

export interface CreatePost {
  channel_id: string;
  message: string;
  root_id?: string;
  file_ids?: string[];
  props?: Record<string, unknown>;
}

export interface MattermostFile {
  id: string;
  name: string;
  size: number;
  mime_type: string;
}

export interface MattermostCommandDefinition {
  team_id: string;
  trigger: string;
  method: "P" | "G";
  url: string;
  auto_complete?: boolean;
  auto_complete_desc?: string;
  auto_complete_hint?: string;
  display_name?: string;
  description?: string;
}

export class MattermostApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
  ) {
    // Do not include server response bodies, which may contain credentials or user content.
    super(`Mattermost ${method} ${path} failed (${status})`);
  }
}

/** Transport only: no Telegram types, global settings, or OpenCode session state. */
export class MattermostClient {
  readonly apiUrl: string;
  readonly websocketUrl: string;

  constructor(
    serverUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(serverUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "Mattermost URL must be an HTTP(S) server URL without credentials, query, or fragment",
      );
    }
    if (!token.trim()) throw new Error("Mattermost access token is required");
    this.apiUrl = `${url.toString().replace(/\/+$/, "")}/api/v4`;
    const websocket = new URL(`${this.apiUrl}/websocket`);
    websocket.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    this.websocketUrl = websocket.toString();
  }

  /** Header authentication also works for the Node WebSocket client. */
  authenticationHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  private async request(path: string, method = "GET", body?: unknown): Promise<Response> {
    const isForm = body instanceof FormData;
    const response = await this.fetcher(`${this.apiUrl}${path}`, {
      method,
      headers: {
        ...this.authenticationHeaders(),
        ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: isForm ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
      // Never forward the bearer token to a redirect target.
      redirect: "error",
    });
    if (!response.ok) throw new MattermostApiError(response.status, method, path);
    return response;
  }

  async getMe(): Promise<MattermostUser> {
    return (await this.request("/users/me")).json() as Promise<MattermostUser>;
  }

  async getPost(postId: string): Promise<MattermostPost> {
    return (
      await this.request(`/posts/${encodeURIComponent(postId)}`)
    ).json() as Promise<MattermostPost>;
  }

  async getPostsSince(
    channelId: string,
    since: number,
  ): Promise<{ order: string[]; posts: Record<string, MattermostPost> }> {
    if (!Number.isSafeInteger(since) || since < 0)
      throw new Error("since must be a non-negative millisecond timestamp");
    return (
      await this.request(`/channels/${encodeURIComponent(channelId)}/posts?since=${since}`)
    ).json() as Promise<{ order: string[]; posts: Record<string, MattermostPost> }>;
  }

  async createPost(post: CreatePost): Promise<MattermostPost> {
    return (await this.request("/posts", "POST", post)).json() as Promise<MattermostPost>;
  }

  async editPost(
    postId: string,
    update: { message?: string; props?: Record<string, unknown> },
  ): Promise<MattermostPost> {
    // PATCH preserves fields that the caller did not supply, including attachments.
    return (
      await this.request(`/posts/${encodeURIComponent(postId)}/patch`, "PUT", update)
    ).json() as Promise<MattermostPost>;
  }

  async deletePost(postId: string): Promise<void> {
    await this.request(`/posts/${encodeURIComponent(postId)}`, "DELETE");
  }

  async uploadFile(
    channelId: string,
    name: string,
    bytes: Uint8Array,
    mimeType = "application/octet-stream",
  ): Promise<MattermostFile[]> {
    const form = new FormData();
    form.append("channel_id", channelId);
    form.append("files", new Blob([new Uint8Array(bytes)], { type: mimeType }), name);
    const result = (await (await this.request("/files", "POST", form)).json()) as {
      file_infos: MattermostFile[];
    };
    return result.file_infos;
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    return new Uint8Array(
      await (await this.request(`/files/${encodeURIComponent(fileId)}`)).arrayBuffer(),
    );
  }

  async getFileInfo(fileId: string): Promise<MattermostFile> {
    return (
      await this.request(`/files/${encodeURIComponent(fileId)}/info`)
    ).json() as Promise<MattermostFile>;
  }

  async createCommand(
    definition: MattermostCommandDefinition,
  ): Promise<MattermostCommandDefinition & { id: string; token: string }> {
    return (await this.request("/commands", "POST", definition)).json() as Promise<
      MattermostCommandDefinition & { id: string; token: string }
    >;
  }

  async sendFile(
    post: Omit<CreatePost, "file_ids">,
    name: string,
    bytes: Uint8Array,
    mimeType?: string,
  ): Promise<MattermostPost> {
    const files = await this.uploadFile(post.channel_id, name, bytes, mimeType);
    return this.createPost({ ...post, file_ids: files.map((file) => file.id) });
  }

  async addReaction(userId: string, postId: string, emojiName: string): Promise<void> {
    await this.request("/reactions", "POST", {
      user_id: userId,
      post_id: postId,
      emoji_name: emojiName,
    });
  }

  async openDialog(
    triggerId: string,
    dialog: Record<string, unknown>,
    callbackUrl: string,
  ): Promise<void> {
    await this.request("/actions/dialogs/open", "POST", {
      trigger_id: triggerId,
      url: callbackUrl,
      dialog,
    });
  }
}
