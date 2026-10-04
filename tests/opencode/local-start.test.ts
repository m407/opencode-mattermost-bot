import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  probeMock: vi.fn(),
  findRegisteredMock: vi.fn(),
  readLocalVersionMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: { global: { health: vi.fn() } },
  probeOpencodeServer: mocked.probeMock,
  findRegisteredOpencodeServerUrl: mocked.findRegisteredMock,
}));

vi.mock("../../src/opencode/process.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/opencode/process.js")>()),
  readLocalOpencodeVersion: mocked.readLocalVersionMock,
}));

vi.mock("../../src/config.js", () => ({
  config: {
    opencode: { apiUrl: "http://127.0.0.1:4097" },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

import { canStartLocalOpencodeServer } from "../../src/opencode/local-start.js";
import { __resetServerHealthStateForTests } from "../../src/opencode/server-health.js";

const TARGET = { host: "127.0.0.1", port: 4097 };

function errorMessage(): string {
  return mocked.loggerErrorMock.mock.calls[0]?.[0] as string;
}

describe("opencode/local-start", () => {
  beforeEach(() => {
    __resetServerHealthStateForTests();
    mocked.probeMock.mockReset();
    mocked.probeMock.mockResolvedValue({ kind: "none" });
    mocked.findRegisteredMock.mockReset();
    mocked.findRegisteredMock.mockResolvedValue(null);
    mocked.readLocalVersionMock.mockReset();
    mocked.readLocalVersionMock.mockResolvedValue("2.0.16");
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();
  });

  it("allows a start when nothing answers and the executable matches", async () => {
    await expect(canStartLocalOpencodeServer(TARGET, "always")).resolves.toBe(true);
    expect(mocked.loggerErrorMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
  });

  it("refuses when the configured address rejects the credentials", async () => {
    mocked.probeMock.mockResolvedValue({ kind: "unauthorized" });

    await expect(canStartLocalOpencodeServer(TARGET, "always")).resolves.toBe(false);
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Authentication failed"),
    );
    expect(mocked.loggerErrorMock).not.toHaveBeenCalled();
    expect(mocked.readLocalVersionMock).not.toHaveBeenCalled();
  });

  it("refuses when a server of the other version answers at the configured address", async () => {
    mocked.probeMock.mockResolvedValue({ kind: "unsupported" });

    await expect(canStartLocalOpencodeServer(TARGET, "always")).resolves.toBe(false);
    expect(errorMessage()).toContain("supported OpenCode V2 API");
  });

  it("refuses on V2 while a registered V2 server runs on another port", async () => {
    mocked.findRegisteredMock.mockResolvedValue("http://127.0.0.1:49374");

    await expect(canStartLocalOpencodeServer(TARGET, "always")).resolves.toBe(false);
    expect(errorMessage()).toContain("http://127.0.0.1:49374");
    expect(errorMessage()).toContain("OPENCODE_API_URL=http://127.0.0.1:49374");
    expect(mocked.readLocalVersionMock).not.toHaveBeenCalled();
  });

  it("allows a start when the registered V2 server is on the configured port", async () => {
    mocked.findRegisteredMock.mockResolvedValue("http://localhost:4097");

    await expect(canStartLocalOpencodeServer(TARGET, "always")).resolves.toBe(true);
  });

  it("refuses when the local opencode executable is the other version", async () => {
    mocked.readLocalVersionMock.mockResolvedValue("1.18.32");

    await expect(canStartLocalOpencodeServer(TARGET, "always")).resolves.toBe(false);
    expect(errorMessage()).toContain("only OpenCode 2.x is supported");
    expect(errorMessage()).toContain("Local executable is OpenCode 1.18.32");
    expect(errorMessage()).toContain("Install @opencode/cli");
  });

  it("allows a start when the executable version cannot be read", async () => {
    mocked.readLocalVersionMock.mockResolvedValue(null);

    await expect(canStartLocalOpencodeServer(TARGET, "always")).resolves.toBe(true);
  });

  it("logs a repeated refusal once in once mode and every time in always mode", async () => {
    mocked.readLocalVersionMock.mockResolvedValue("1.18.32");

    await canStartLocalOpencodeServer(TARGET, "once");
    await canStartLocalOpencodeServer(TARGET, "once");
    expect(mocked.loggerErrorMock).toHaveBeenCalledTimes(1);

    await canStartLocalOpencodeServer(TARGET, "always");
    expect(mocked.loggerErrorMock).toHaveBeenCalledTimes(2);
  });
});
