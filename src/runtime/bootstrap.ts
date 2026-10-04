import fs from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import dotenv from "dotenv";
import { getRuntimePaths } from "./paths.js";

export type WizardEnvValues = Record<string, string>;
const required = [
  "MATTERMOST_URL",
  "MATTERMOST_BOT_TOKEN",
  "MATTERMOST_ALLOWED_USER_ID",
  "MATTERMOST_CHANNEL_ID",
  "OPENCODE_MODEL_PROVIDER",
  "OPENCODE_MODEL_ID",
];
export function validateRuntimeEnvValues(values: Record<string, string>): {
  isValid: boolean;
  reason?: string;
} {
  for (const key of required)
    if (!values[key]?.trim()) return { isValid: false, reason: `Missing ${key}` };
  for (const key of ["MATTERMOST_ALLOWED_USER_ID", "MATTERMOST_CHANNEL_ID"])
    if (!/^[a-z0-9]{26}$/.test(values[key] ?? ""))
      return { isValid: false, reason: `Invalid ${key}` };
  for (const key of ["MATTERMOST_URL", "OPENCODE_API_URL"]) {
    if (!values[key]) continue;
    try {
      const url = new URL(values[key]);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
    } catch {
      return { isValid: false, reason: `Invalid ${key}` };
    }
  }
  if (values.OPENCODE_SERVER_VERSION && !["v1", "v2"].includes(values.OPENCODE_SERVER_VERSION))
    return { isValid: false, reason: "Invalid OPENCODE_SERVER_VERSION" };
  return { isValid: true };
}
export function buildEnvFileContent(existing: string, values: WizardEnvValues): string {
  const remaining = new Set(Object.keys(values));
  const lines = existing.split(/\r?\n/).map((line) => {
    const key = /^\s*(?:export\s+)?([A-Z_][A-Z_0-9]*)\s*=/.exec(line)?.[1];
    if (!key || !remaining.has(key)) return line;
    remaining.delete(key);
    return `${key}=${JSON.stringify(values[key])}`;
  });
  for (const key of remaining) lines.push(`${key}=${JSON.stringify(values[key])}`);
  return lines.join("\n").trim() + "\n";
}
async function readEnv(): Promise<string> {
  try {
    return await fs.readFile(getRuntimePaths().envFilePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
export async function ensureRuntimeConfigForStart(): Promise<void> {
  const values = { ...dotenv.parse(await readEnv()), ...process.env } as Record<string, string>;
  const result = validateRuntimeEnvValues(values);
  if (result.isValid) return;
  if (!process.stdin.isTTY)
    throw new Error(`${result.reason}. Run opencode-mattermost config first.`);
  await runConfigWizardCommand();
}
export async function runConfigWizardCommand(): Promise<void> {
  const existing = await readEnv();
  const values = dotenv.parse(existing);
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const input = createInterface({
    input: process.stdin,
    output,
    terminal: Boolean(process.stdin.isTTY),
  });
  try {
    for (const key of [
      ...required,
      "OPENCODE_SERVER_VERSION",
      "OPENCODE_API_URL",
      "OPENCODE_SERVER_PASSWORD",
    ]) {
      const current = values[key] ?? (key === "OPENCODE_SERVER_VERSION" ? "v2" : "");
      const secret = /TOKEN|PASSWORD/.test(key);
      process.stdout.write(
        `${key}${current ? (secret ? " [configured]" : ` [${current}]`) : ""}: `,
      );
      muted = secret;
      let answer: string;
      try {
        answer = await input.question("");
      } finally {
        muted = false;
        if (secret) process.stdout.write("\n");
      }
      values[key] = answer.trim() || current;
    }
    const result = validateRuntimeEnvValues(values);
    if (!result.isValid) throw new Error(result.reason);
    await fs.mkdir(getRuntimePaths().appHome, { recursive: true });
    await fs.writeFile(getRuntimePaths().envFilePath, buildEnvFileContent(existing, values), {
      mode: 0o600,
    });
    await fs.chmod(getRuntimePaths().envFilePath, 0o600);
  } finally {
    input.close();
  }
}
