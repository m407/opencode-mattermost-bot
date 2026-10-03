import { once } from "node:events";
import { WebSocketServer } from "ws";
import { describe, expect, it, vi } from "vitest";
import { MattermostClient, type MattermostPost } from "../../src/mattermost/client.js";
import { MattermostEvents, parsePostEvent } from "../../src/mattermost/events.js";

const options = { allowedUserId: "user", allowedChannelIds: ["channel"] };
const post: MattermostPost = {
  id: "post",
  user_id: "user",
  channel_id: "channel",
  message: "Prompt",
  root_id: "",
  create_at: 1,
  update_at: 1,
  delete_at: 0,
  type: "",
  props: {},
};
const envelope = (value = post, kind = "posted") =>
  JSON.stringify({ event: kind, data: { post: JSON.stringify(value) } });

describe("Mattermost events", () => {
  it("normalizes root and reply posts and preserves attachment IDs", () => {
    expect(parsePostEvent(envelope(), "bot", options)?.threadId).toBe("post");
    const result = parsePostEvent(
      envelope({ ...post, root_id: "root", file_ids: ["file"] }, "post_edited"),
      "bot",
      options,
    );
    expect(result?.threadId).toBe("root");
    expect(result?.kind).toBe("post_edited");
    expect(result?.post.file_ids).toEqual(["file"]);
  });

  it("ignores unauthorized users, channels, own posts, system and deleted posts", () => {
    for (const change of [
      { user_id: "other" },
      { user_id: "bot" },
      { channel_id: "other" },
      { type: "system_join_channel" },
      { delete_at: 1 },
    ]) {
      expect(parsePostEvent(envelope({ ...post, ...change }), "bot", options)).toBeNull();
    }
    expect(parsePostEvent(JSON.stringify({ event: "typing" }), "bot", options)).toBeNull();
    expect(
      parsePostEvent(JSON.stringify({ event: "posted", data: { post: "{}" } }), "bot", options),
    ).toBeNull();
  });

  it("authenticates, suppresses duplicate deliveries, reconnects, and shuts down", async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (typeof address === "string" || !address) throw new Error("Missing test server address");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify({ id: "bot" })));
    const onPost = vi.fn().mockResolvedValue(undefined);
    const onConnected = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const events = new MattermostEvents(
      new MattermostClient(`http://127.0.0.1:${address.port}`, "secret", fetcher),
      { ...options, onPost, onConnected, onError },
    );
    try {
      const firstConnection = once(server, "connection");
      await events.start();
      const [socket, request] = await firstConnection;
      expect(request.headers.authorization).toBe("Bearer secret");
      expect(request.url).toBe("/api/v4/websocket");
      socket.send(JSON.stringify({ event: "hello" }));
      socket.send("malformed json");
      socket.send(envelope());
      socket.send(envelope());
      socket.send(envelope({ ...post, user_id: "bot" }));
      await vi.waitFor(() => expect(onPost).toHaveBeenCalledTimes(1));
      expect(onConnected).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      const secondConnection = once(server, "connection");
      socket.close();
      const [second] = await secondConnection;
      second.send(JSON.stringify({ event: "hello" }));
      second.send(envelope());
      second.send(envelope({ ...post, message: "Edited", update_at: 2 }, "post_edited"));
      await vi.waitFor(() => expect(onPost).toHaveBeenCalledTimes(2));
      expect(onConnected).toHaveBeenCalledTimes(2);
      await events.stop();
      expect(server.clients.size).toBeLessThanOrEqual(1);
    } finally {
      await events.stop();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("propagates startup authentication errors without connecting", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 401 }));
    const events = new MattermostEvents(
      new MattermostClient("https://chat.example", "secret", fetcher),
      { ...options, onPost: vi.fn() },
    );
    await expect(events.start()).rejects.toThrow("401");
    await events.stop();
  });
});
