import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/config.js", () => ({
  config: {
    opencode: { apiUrl: "http://localhost:49374/", username: "opencode", password: "test-secret" },
  },
}));
vi.mock("../../src/opencode/v2/client.js", () => ({
  createV2OpencodeClient: vi.fn(() => ({})),
  findRegisteredV2ServerUrl: vi.fn(),
}));
import { probeOpencodeServer } from "../../src/opencode/client.js";

describe("OpenCode server probe", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  it("probes only the V2 endpoint with configured authentication", async () => {
    fetchMock.mockResolvedValue(Response.json({ version: "2.0.16", pid: 123 }));
    await expect(probeOpencodeServer()).resolves.toEqual({
      kind: "found",
      serverVersion: "2.0.16",
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      new URL("http://localhost:49374/api/info"),
      expect.objectContaining({
        headers: {
          Authorization: `Basic ${Buffer.from("opencode:test-secret").toString("base64")}`,
        },
        redirect: "error",
      }),
    );
  });
  it.each([401, 403])("reports authentication rejection %s", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    await expect(probeOpencodeServer()).resolves.toEqual({ kind: "unauthorized" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    Response.json({ version: "1.18.32", pid: 123 }),
    Response.json({ version: "2.0.16" }),
    new Response("Not found", { status: 404 }),
    new Response("<html/>", { headers: { "Content-Type": "text/html" } }),
  ])("rejects an unsupported endpoint without falling back", async (response) => {
    fetchMock.mockResolvedValue(response);
    await expect(probeOpencodeServer()).resolves.toEqual({ kind: "unsupported" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("reports unreachable server", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    await expect(probeOpencodeServer()).resolves.toEqual({ kind: "none" });
  });
});
