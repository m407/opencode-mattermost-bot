import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { isExpectedOpencodeUnavailableError } from "../utils/opencode-error.js";
import { opencodeClient, probeOpencodeServer } from "./client.js";

export type OpencodeHealth =
  { healthy: true; version: string | undefined } | { healthy: false; error: unknown };

/** "always" logs every time (a user asked); "once" logs a problem once until it changes. */
export type ProblemReportMode = "always" | "once";

/** Why the configured URL did not answer as a healthy OpenCode V2 server. */
export type FailedHealthCause =
  { kind: "unauthorized" } | { kind: "unsupported" } | { kind: "unknown" };

let lastReportedProblem: string | null = null;

export function describeServerUrl(): string {
  try {
    const url = new URL(config.opencode.apiUrl);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "the configured OPENCODE_API_URL";
  }
}

/** Logs an OpenCode problem; in "once" mode the same problem is not logged again in a row. */
export function reportOpencodeProblem(
  key: string,
  mode: ProblemReportMode,
  report: () => void,
): void {
  if (mode === "once" && lastReportedProblem === key) {
    return;
  }
  lastReportedProblem = key;
  report();
}

/** Distinguish authentication failures from an unsupported endpoint. */
export async function classifyFailedHealthCheck(): Promise<FailedHealthCause> {
  const result = await probeOpencodeServer();
  if (result.kind === "unauthorized" || result.kind === "unsupported") return result;
  return { kind: "unknown" };
}

/** Writes the log line for a failed health check cause; an unknown cause logs nothing. */
export function reportFailedHealthCause(cause: FailedHealthCause, mode: ProblemReportMode): void {
  if (cause.kind === "unauthorized") {
    reportOpencodeProblem("unauthorized", mode, () =>
      logger.warn(
        `[OpenCode] Authentication failed at ${describeServerUrl()}: check OPENCODE_SERVER_USERNAME and OPENCODE_SERVER_PASSWORD`,
      ),
    );
    return;
  }

  if (cause.kind === "unsupported") {
    reportOpencodeProblem("unsupported", mode, () =>
      logger.error(
        `[OpenCode] The endpoint at ${describeServerUrl()} does not provide the supported OpenCode V2 API. Check OPENCODE_API_URL and install OpenCode 2.x.`,
      ),
    );
  }
}

/** Explains a failed health check in the log: wrong credentials or an unsupported endpoint. */
export async function explainFailedHealthCheck(mode: ProblemReportMode): Promise<void> {
  reportFailedHealthCause(await classifyFailedHealthCheck(), mode);
}

/**
 * Health of the server at the configured URL through the supported API. A server
 * that answers with anything but the expected health shape is unhealthy.
 */
export async function checkOpencodeHealth(): Promise<OpencodeHealth> {
  let error: unknown;
  try {
    const result = await opencodeClient.global.health();
    if (!result.error && result.data?.healthy === true) {
      lastReportedProblem = null;
      return { healthy: true, version: result.data.version };
    }
    error = result.error ?? new Error("Unexpected OpenCode health response");
  } catch (caught) {
    error = caught;
  }

  if (!isExpectedOpencodeUnavailableError(error)) {
    await explainFailedHealthCheck("once");
  }
  return { healthy: false, error };
}

export function __resetServerHealthStateForTests(): void {
  lastReportedProblem = null;
}
