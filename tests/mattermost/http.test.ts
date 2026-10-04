import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createCallbackServer } from "../../src/mattermost/http.js";
import { MattermostActions } from "../../src/mattermost/actions.js";
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
async function start() {
  const onCommand = vi.fn();
  const onAction = vi.fn().mockResolvedValue({ ephemeral_text: "done" });
  const actions = new MattermostActions("https://bot.test/mm/actions", onAction);
  const attachment = actions.createAttachment(
    { userId: "user", channelId: "channel", postId: "post" },
    [{ name: "Approve", data: "approve" }],
  );
  const action = (attachment.actions as { integration: { context: { token: string } } }[])[0]!;
  const server = createCallbackServer({
    path: "/mm",
    secret: "callback-secret",
    commandToken: () => "slash-secret",
    userId: "user",
    channelId: "channel",
    actions,
    onCommand,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, onCommand, onAction, token: action.integration.context.token };
}
describe("callback authentication", () => {
  it("requires the trusted proxy secret before accepting an action token", async () => {
    const { base, onAction, token } = await start();
    const body = JSON.stringify({
      user_id: "user",
      channel_id: "channel",
      post_id: "post",
      context: { token },
    });
    const send = (secret: string) =>
      fetch(`${base}/mm/actions`, {
        method: "POST",
        body,
        headers: { "content-type": "application/json", "x-mattermost-callback-secret": secret },
      });
    expect((await send("wrong")).status).toBe(403);
    expect(onAction).not.toHaveBeenCalled();
    expect((await send("callback-secret")).status).toBe(200);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect((await send("callback-secret")).status).toBe(403);
  });
  it("requires slash token and user/channel allowlist, preserving the thread", async () => {
    const { base, onCommand } = await start();
    const send = (extra: Record<string, string>) =>
      fetch(`${base}/mm/commands`, {
        method: "POST",
        body: new URLSearchParams({
          token: "slash-secret",
          user_id: "user",
          channel_id: "channel",
          text: "new",
          root_id: "thread",
          ...extra,
        }),
      });
    expect((await send({ token: "wrong" })).status).toBe(403);
    expect((await send({ user_id: "other" })).status).toBe(403);
    expect(onCommand).not.toHaveBeenCalled();
    expect((await send({})).status).toBe(200);
    expect(onCommand).toHaveBeenCalledWith({
      user_id: "user",
      channel_id: "channel",
      text: "new",
      root_id: "thread",
    });
  });
  it("bounds request payloads and rejects malformed JSON", async () => {
    const { base, onCommand } = await start();
    expect(
      (await fetch(`${base}/mm/commands`, { method: "POST", body: "x".repeat(65537) })).status,
    ).toBe(413);
    expect(
      (
        await fetch(`${base}/mm/commands`, {
          method: "POST",
          body: "{bad",
          headers: { "content-type": "application/json" },
        })
      ).status,
    ).toBe(400);
    expect(onCommand).not.toHaveBeenCalled();
  });
});
