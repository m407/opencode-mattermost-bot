import { describe, expect, it, vi } from "vitest";
import { MattermostClient } from "../../src/mattermost/client.js";
import {
  MattermostMessages,
  MattermostStream,
  splitMessage,
} from "../../src/mattermost/messages.js";
describe("Mattermost output", () => {
  it("preserves every character when splitting long Unicode text", () => {
    const original = "x".repeat(13999) + "😀\n" + "y".repeat(16000);
    const chunks = splitMessage(original);
    expect(chunks.join("")).toBe(original);
    expect(chunks.every((chunk) => chunk.length <= 14000 && !/[\uD800-\uDBFF]$/.test(chunk))).toBe(
      true,
    );
  });
  it("coalesces text updates and flushes the final answer in the original thread", async () => {
    vi.useFakeTimers();
    const client = new MattermostClient("https://chat.test", "token");
    const create = vi.spyOn(client, "createPost").mockResolvedValue({ id: "answer" } as never);
    const edit = vi.spyOn(client, "editPost").mockResolvedValue({ id: "answer" } as never);
    const stream = new MattermostStream(
      new MattermostMessages(client, "user"),
      { channelId: "channel", rootId: "thread" },
      vi.fn(),
    );
    stream.update("a");
    stream.update("abc");
    stream.update("abcd");
    expect(create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(create).toHaveBeenCalledExactlyOnceWith({
      channel_id: "channel",
      root_id: "thread",
      message: "abcd",
    });
    await stream.finish("complete");
    expect(edit).toHaveBeenCalledExactlyOnceWith("answer", { message: "complete" });
    stream.update("ignored");
    await vi.advanceTimersByTimeAsync(1000);
    expect(edit).toHaveBeenCalledTimes(1);
  });
  it("cancels a streamed download as soon as its byte limit is exceeded", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel,
    });
    const client = new MattermostClient(
      "https://chat.test",
      "token",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
    );
    await expect(client.downloadFile("large", 10)).rejects.toThrow("size limit");
    expect(cancel).toHaveBeenCalled();
  });
});
