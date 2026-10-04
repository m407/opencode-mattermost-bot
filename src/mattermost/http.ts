import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { MattermostActions } from "./actions.js";

export interface CommandRequest {
  user_id: string;
  channel_id: string;
  text: string;
  root_id?: string;
}

export function secretMatches(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string" || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createCallbackServer(options: {
  path: string;
  secret: string;
  commandToken: () => string;
  userId: string;
  channelId: string;
  actions: MattermostActions;
  onCommand: (request: CommandRequest) => void;
}): Server {
  const reply = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const route = (request.url ?? "").split("?")[0];
    if (
      request.method !== "POST" ||
      ![`${options.path}/actions`, `${options.path}/commands`].includes(route ?? "")
    ) {
      reply(response, 404, {});
      return;
    }
    const isAction = route === `${options.path}/actions`;
    if (
      isAction &&
      !secretMatches(request.headers["x-mattermost-callback-secret"], options.secret)
    ) {
      reply(response, 403, {});
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk as Uint8Array);
      length += bytes.length;
      if (length > 65_536) {
        reply(response, 413, {});
        return;
      }
      chunks.push(bytes);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const contentType = request.headers["content-type"] ?? "";
    const body: unknown = contentType.startsWith("application/json")
      ? JSON.parse(raw)
      : Object.fromEntries(new URLSearchParams(raw));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      reply(response, 400, {});
      return;
    }
    const value = body as Record<string, unknown>;
    if (value.user_id !== options.userId || value.channel_id !== options.channelId) {
      reply(response, 403, {});
      return;
    }
    if (isAction) {
      const result = await options.actions.handle(body);
      reply(response, result.status, result.body);
      return;
    }
    if (!secretMatches(value.token, options.commandToken())) {
      reply(response, 403, {});
      return;
    }
    if (typeof value.text !== "string") {
      reply(response, 400, {});
      return;
    }
    options.onCommand({
      user_id: options.userId,
      channel_id: options.channelId,
      text: value.text,
      ...(typeof value.root_id === "string" ? { root_id: value.root_id } : {}),
    });
    reply(response, 200, { response_type: "ephemeral", text: "Command accepted." });
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) reply(response, 400, {});
      else response.end();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
