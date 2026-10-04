import { logger } from "../utils/logger.js";
import { findRegisteredOpencodeServerUrl } from "./client.js";
import {
  isSupportedOpencodeVersion,
  readLocalOpencodeVersion,
  type LocalOpencodeTarget,
} from "./process.js";
import {
  classifyFailedHealthCheck,
  describeServerUrl,
  reportFailedHealthCause,
  reportOpencodeProblem,
  type ProblemReportMode,
} from "./server-health.js";

function getUrlPort(url: string): number | null {
  try {
    const parsedUrl = new URL(url);
    const port = Number.parseInt(parsedUrl.port, 10);
    return Number.isInteger(port) ? port : null;
  } catch {
    return null;
  }
}

/** Refuses when OpenCode V2 already runs its one registered background server on another port. */
async function isBlockedByRegisteredServer(
  target: LocalOpencodeTarget,
  mode: ProblemReportMode,
): Promise<boolean> {
  const registeredUrl = await findRegisteredOpencodeServerUrl();
  if (!registeredUrl || getUrlPort(registeredUrl) === target.port) {
    return false;
  }

  reportOpencodeProblem(`registered:${registeredUrl}`, mode, () =>
    logger.error(
      `[OpenCode] Not starting a local OpenCode v2 server for ${describeServerUrl()}: a registered OpenCode v2 background server is already running at ${registeredUrl}, and starting another one would replace it. Set OPENCODE_API_URL=${registeredUrl} and restart the bot, or stop that server (opencode service stop).`,
    ),
  );
  return true;
}

/** Refuses when the local `opencode` executable is a release of the other API version. */
async function isBlockedByExecutableVersion(mode: ProblemReportMode): Promise<boolean> {
  const executableVersion = await readLocalOpencodeVersion();
  if (!executableVersion) {
    return false;
  }

  if (isSupportedOpencodeVersion(executableVersion)) {
    return false;
  }

  reportOpencodeProblem(`executable:${executableVersion}`, mode, () =>
    logger.error(
      `[OpenCode] Local executable is OpenCode ${executableVersion}; only OpenCode 2.x is supported. Install @opencode/cli and make it the first opencode executable on PATH.`,
    ),
  );
  return true;
}

/**
 * Decides whether a local OpenCode server may be started for the configured URL, after its
 * health check failed. Every refusal is explained in the log; nothing is started here.
 */
export async function canStartLocalOpencodeServer(
  target: LocalOpencodeTarget,
  mode: ProblemReportMode,
): Promise<boolean> {
  const cause = await classifyFailedHealthCheck();
  if (cause.kind !== "unknown") {
    reportFailedHealthCause(cause, mode);
    return false;
  }

  if (await isBlockedByRegisteredServer(target, mode)) {
    return false;
  }

  return !(await isBlockedByExecutableVersion(mode));
}
