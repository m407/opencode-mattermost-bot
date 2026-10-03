import { describe, expect, it, vi } from "vitest";
import { MattermostActions } from "../../src/mattermost/actions.js";

const target = { userId: "user", channelId: "channel", postId: "post" };
function request(attachment: Record<string, unknown>) {
  const actions = attachment.actions as { integration: { context: { token: string } } }[];
  return {
    user_id: "user",
    channel_id: "channel",
    post_id: "post",
    context: actions[0]!.integration.context,
  };
}

describe("Mattermost interactive actions", () => {
  it("binds opaque tokens to user, channel, and post and rejects replay", async () => {
    const handler = vi.fn().mockResolvedValue({ ephemeral_text: "Done" });
    const actions = new MattermostActions("https://bot.example/actions", handler);
    const body = request(
      actions.createAttachment(target, [{ name: "Approve", data: "approve:42" }]),
    );
    for (const key of ["user_id", "channel_id", "post_id"] as const) {
      expect((await actions.handle({ ...body, [key]: "wrong" })).status).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled();
    const results = await Promise.all([actions.handle(body), actions.handle(body)]);
    expect(results.map((result) => result.status)).toEqual([200, 403]);
    expect(handler).toHaveBeenCalledExactlyOnceWith("approve:42", body);
    expect(results[0]?.body).toEqual({ ephemeral_text: "Done" });
  });

  it("rejects malformed, expired, and invalidated callbacks", async () => {
    vi.useFakeTimers();
    const actions = new MattermostActions("https://bot.example/actions", vi.fn());
    expect((await actions.handle(null)).status).toBe(400);
    expect((await actions.handle({ context: { token: 3 } })).status).toBe(400);
    const expired = request(
      actions.createAttachment(target, [{ name: "Go", data: "go" }], "", 1000),
    );
    vi.advanceTimersByTime(1000);
    expect((await actions.handle(expired)).status).toBe(403);
    const invalidated = request(actions.createAttachment(target, [{ name: "Go", data: "go" }]));
    actions.invalidatePost("post");
    expect((await actions.handle(invalidated)).status).toBe(403);
  });

  it("validates dropdown choices and returns synchronous update JSON", async () => {
    const handler = vi.fn().mockResolvedValue({ update: { message: "Selected", props: {} } });
    const actions = new MattermostActions("https://bot.example/actions", handler);
    const body = request(
      actions.createAttachment(target, [
        { name: "Choose", data: "model", options: [{ text: "One", value: "one" }] },
      ]),
    );
    expect(
      (await actions.handle({ ...body, context: { ...body.context, selected_option: "two" } }))
        .status,
    ).toBe(400);
    expect(
      (await actions.handle({ ...body, context: { ...body.context, selected_option: "one" } }))
        .body,
    ).toEqual({ update: { message: "Selected", props: {} } });
  });

  it("contains handler errors without exposing internals or executing again", async () => {
    const actions = new MattermostActions("https://bot.example/actions", async () => {
      throw new Error("secret");
    });
    const body = request(actions.createAttachment(target, [{ name: "Go", data: "go" }]));
    expect(await actions.handle(body)).toEqual({ status: 500, body: {} });
    expect((await actions.handle(body)).status).toBe(403);
  });
});
