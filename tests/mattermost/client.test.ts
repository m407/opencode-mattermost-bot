import { describe, expect, it, vi } from "vitest";
import { MattermostClient, MattermostApiError } from "../../src/mattermost/client.js";

describe("Mattermost REST client", () => {
  it("registers native slash commands and reads file metadata", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "command", token: "command-secret" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "file", name: "notes.txt", size: 12, mime_type: "text/plain" }),
        ),
      );
    const client = new MattermostClient("https://chat.example", "secret", fetcher);
    const definition = {
      team_id: "team",
      trigger: "opencode",
      method: "P" as const,
      url: "https://bot.example/commands",
    };
    expect((await client.createCommand(definition)).token).toBe("command-secret");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://chat.example/api/v4/commands");
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual(definition);
    expect((await client.getFileInfo("file")).name).toBe("notes.txt");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://chat.example/api/v4/files/file/info");
  });
  it("preserves a server subpath and authenticates without putting tokens in URLs", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: "bot" })));
    const client = new MattermostClient("https://chat.example/mattermost/", "secret", fetcher);
    expect(client.websocketUrl).toBe("wss://chat.example/mattermost/api/v4/websocket");
    await client.getMe();
    expect(fetcher).toHaveBeenCalledWith(
      "https://chat.example/mattermost/api/v4/users/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret" },
        redirect: "error",
      }),
    );
  });

  it("uploads first, then attaches file IDs and preserves the root thread", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ file_infos: [{ id: "file1" }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "post1" })));
    const client = new MattermostClient("https://chat.example", "secret", fetcher);
    await client.sendFile(
      { channel_id: "channel", root_id: "root", message: "caption" },
      "image.png",
      new Uint8Array([1, 2]),
      "image/png",
    );
    const upload = fetcher.mock.calls[0]?.[1];
    expect(upload?.body).toBeInstanceOf(FormData);
    expect((upload?.body as FormData).get("channel_id")).toBe("channel");
    const file = (upload?.body as FormData).get("files") as File;
    expect(file.name).toBe("image.png");
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2]);
    expect(upload?.headers).toEqual({ Authorization: "Bearer secret" });
    expect(JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string)).toEqual({
      channel_id: "channel",
      root_id: "root",
      message: "caption",
      file_ids: ["file1"],
    });
  });

  it("does not post or retry a failed upload", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("sensitive server error", { status: 503 }));
    const client = new MattermostClient("https://chat.example", "secret", fetcher);
    await expect(
      client.sendFile({ channel_id: "channel", message: "" }, "file", new Uint8Array()),
    ).rejects.toThrow(MattermostApiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("patches text without clearing props and downloads with authentication", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 255])));
    const client = new MattermostClient("http://localhost:8065", "secret", fetcher);
    await client.editPost("post", { message: "new" });
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://localhost:8065/api/v4/posts/post/patch");
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({ message: "new" });
    expect(await client.downloadFile("file")).toEqual(new Uint8Array([0, 255]));
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({ Authorization: "Bearer secret" });
  });

  it("rejects unsafe server URLs and empty tokens", () => {
    for (const url of [
      "file:///etc/passwd",
      "https://user:pass@host",
      "https://host?token=secret",
      "https://host#fragment",
    ]) {
      expect(() => new MattermostClient(url, "secret")).toThrow();
    }
    expect(() => new MattermostClient("https://host", " ")).toThrow();
  });
});
