import { config } from "../config.js";
import { createV2OpencodeClient, findRegisteredV2ServerUrl } from "./v2/client.js";

const PROBE_TIMEOUT_MS = 5000;

const getAuth = () => {
  if (!config.opencode.password) {
    return undefined;
  }
  const credentials = `${config.opencode.username}:${config.opencode.password}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
};

const authHeaders = (): Record<string, string> | undefined => {
  const auth = getAuth();
  return auth ? { Authorization: auth } : undefined;
};

const headers = authHeaders();
export const opencodeClient = createV2OpencodeClient({
  baseUrl: config.opencode.apiUrl,
  ...(headers ? { headers } : {}),
});

export type OpencodeServerProbe =
  | { kind: "found"; serverVersion: string }
  | { kind: "unauthorized" }
  | { kind: "unsupported" }
  | { kind: "none" };

/** Probe only the supported server API; never fall back to another protocol. */
export async function probeOpencodeServer(): Promise<OpencodeServerProbe> {
  const baseUrl = config.opencode.apiUrl.replace(/\/$/, "") + "/";
  try {
    const headers = authHeaders();
    const response = await fetch(new URL("api/info", baseUrl), {
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    if (!response.ok || !response.headers.get("content-type")?.includes("json"))
      return { kind: "unsupported" };
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === "object" &&
      "version" in body &&
      typeof body.version === "string" &&
      /^2\./.test(body.version) &&
      "pid" in body &&
      typeof body.pid === "number"
    )
      return { kind: "found", serverVersion: body.version };
    return { kind: "unsupported" };
  } catch {
    return { kind: "none" };
  }
}

export async function findRegisteredOpencodeServerUrl(): Promise<string | null> {
  return findRegisteredV2ServerUrl();
}
