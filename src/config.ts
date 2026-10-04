import dotenv from "dotenv";
import { getRuntimePaths } from "./runtime/paths.js";
import { normalizeLocale, type Locale } from "./i18n/index.js";

const runtimePaths = getRuntimePaths();
dotenv.config({ path: runtimePaths.envFilePath, quiet: true });

export type MessageFormatMode = "raw" | "markdown";
export type TtsProvider = "openai" | "google" | "elevenlabs" | "edge";
export type SttRequestFormat = "multipart" | "json";

function getEnvVar(key: string, required: boolean = true): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(
      `Missing required environment variable: ${key} (expected in ${runtimePaths.envFilePath})`,
    );
  }
  return value || "";
}

function getOptionalPathListEnvVar(key: string, delimiter: string = ","): string[] {
  const value = getEnvVar(key, false);
  if (!value || value.trim() === "") {
    return [];
  }
  return value
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function getOptionalPositiveIntEnvVar(key: string, defaultValue: number): number {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return defaultValue;
  }

  return parsedValue;
}

function getOptionalLocaleEnvVar(key: string, defaultValue: Locale): Locale {
  const value = getEnvVar(key, false);
  return normalizeLocale(value, defaultValue);
}

function getOptionalBooleanEnvVar(key: string, defaultValue: boolean): boolean {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

// Reject stale configuration instead of silently connecting to an unsupported server.
function validateOpencodeVersion(): void {
  const version = getEnvVar("OPENCODE_SERVER_VERSION", false).trim().toLowerCase();
  if (version && version !== "v2")
    throw new Error(
      "Only OpenCode V2 is supported. Remove OPENCODE_SERVER_VERSION and configure a V2 server.",
    );
}

function getOptionalMessageFormatModeEnvVar(
  key: string,
  defaultValue: MessageFormatMode,
): MessageFormatMode {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "raw" || normalized === "markdown") {
    return normalized;
  }

  return defaultValue;
}

export function parseInitialSettingsPreset(): Record<string, unknown> {
  const raw = getEnvVar("INITIAL_SETTINGS_PRESET", false).trim();
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("INITIAL_SETTINGS_PRESET contains invalid JSON. Fix or unset the variable.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("INITIAL_SETTINGS_PRESET must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

const VALID_TTS_PROVIDERS: TtsProvider[] = ["openai", "google", "elevenlabs", "edge"];

function getOptionalTtsProviderEnvVar(key: string, defaultValue: TtsProvider): TtsProvider {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (VALID_TTS_PROVIDERS.includes(normalized as TtsProvider)) {
    return normalized as TtsProvider;
  }

  return defaultValue;
}

const VALID_STT_REQUEST_FORMATS: SttRequestFormat[] = ["multipart", "json"];

function getOptionalSttRequestFormatEnvVar(
  key: string,
  defaultValue: SttRequestFormat,
): SttRequestFormat {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (VALID_STT_REQUEST_FORMATS.includes(normalized as SttRequestFormat)) {
    return normalized as SttRequestFormat;
  }

  return defaultValue;
}

export function buildMattermostConfig() {
  const url = getEnvVar("MATTERMOST_URL");
  const server = new URL(url);
  if (
    !["http:", "https:"].includes(server.protocol) ||
    server.username ||
    server.password ||
    server.search ||
    server.hash
  ) {
    throw new Error(
      "MATTERMOST_URL must be an HTTP(S) server URL without credentials, query, or fragment",
    );
  }
  const allowedUserId = getEnvVar("MATTERMOST_ALLOWED_USER_ID");
  const channelId = getEnvVar("MATTERMOST_CHANNEL_ID");
  if (!/^[a-z0-9]{26}$/.test(allowedUserId) || !/^[a-z0-9]{26}$/.test(channelId)) {
    throw new Error("Mattermost user and channel IDs must be 26-character IDs");
  }
  const callbackUrl = getEnvVar("MATTERMOST_CALLBACK_URL", false).replace(/\/+$/, "");
  const callbackSecret = getEnvVar("MATTERMOST_CALLBACK_SECRET", false);
  if (callbackUrl) {
    const callback = new URL(callbackUrl);
    if (
      !["https:", "http:"].includes(callback.protocol) ||
      callback.username ||
      callback.password ||
      callback.search ||
      callback.hash
    ) {
      throw new Error(
        "MATTERMOST_CALLBACK_URL must be an HTTP(S) URL without credentials, query, or fragment",
      );
    }
    if (callbackSecret.length < 32)
      throw new Error("MATTERMOST_CALLBACK_SECRET must contain at least 32 characters");
  }
  const port = getOptionalPositiveIntEnvVar("MATTERMOST_CALLBACK_PORT", 8080);
  if (port > 65535) throw new Error("Invalid MATTERMOST_CALLBACK_PORT");
  return {
    url,
    token: getEnvVar("MATTERMOST_BOT_TOKEN"),
    allowedUserId,
    channelId,
    callbackUrl,
    callbackSecret,
    callbackHost: getEnvVar("MATTERMOST_CALLBACK_HOST", false) || "127.0.0.1",
    callbackPort: port,
    teamId: getEnvVar("MATTERMOST_TEAM_ID", false),
  };
}

validateOpencodeVersion();

export const config = {
  mattermost: buildMattermostConfig(),
  opencode: {
    apiUrl: getEnvVar("OPENCODE_API_URL", false) || "http://127.0.0.1:49374",
    username: getEnvVar("OPENCODE_SERVER_USERNAME", false) || "opencode",
    password: getEnvVar("OPENCODE_SERVER_PASSWORD", false),
    autoRestartEnabled: getOptionalBooleanEnvVar("OPENCODE_AUTO_RESTART_ENABLED", false),
    monitorIntervalSec: getOptionalPositiveIntEnvVar("OPENCODE_MONITOR_INTERVAL_SEC", 300),
    model: {
      provider: getEnvVar("OPENCODE_MODEL_PROVIDER", true), // Required
      modelId: getEnvVar("OPENCODE_MODEL_ID", true), // Required
    },
  },
  server: {
    logLevel: getEnvVar("LOG_LEVEL", false) || "info",
  },
  bot: {
    sessionsListLimit: getOptionalPositiveIntEnvVar("SESSIONS_LIST_LIMIT", 10),
    messagesListLimit: getOptionalPositiveIntEnvVar("MESSAGES_LIST_LIMIT", 10),
    projectsListLimit: getOptionalPositiveIntEnvVar("PROJECTS_LIST_LIMIT", 10),
    commandsListLimit: getOptionalPositiveIntEnvVar("COMMANDS_LIST_LIMIT", 10),
    modelsListLimit: getOptionalPositiveIntEnvVar("MODELS_LIST_LIMIT", 10),
    taskLimit: getOptionalPositiveIntEnvVar("TASK_LIMIT", 10),
    scheduledTaskExecutionTimeoutMinutes: getOptionalPositiveIntEnvVar(
      "SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES",
      120,
    ),
    bashToolDisplayMaxLength: getOptionalPositiveIntEnvVar("BASH_TOOL_DISPLAY_MAX_LENGTH", 128),
    locale: getOptionalLocaleEnvVar("BOT_LOCALE", "en"),
    trackBackgroundSessions: getOptionalBooleanEnvVar("TRACK_BACKGROUND_SESSIONS", true),
    messageFormatMode: getOptionalMessageFormatModeEnvVar("MESSAGE_FORMAT_MODE", "markdown"),
    initialSettingsPreset: parseInitialSettingsPreset(),
    excludedProjectPaths: getOptionalPathListEnvVar("PROJECTS_EXCLUDED_PATHS"),
  },
  files: {
    maxFileSizeKb: parseInt(getEnvVar("CODE_FILE_MAX_SIZE_KB", false) || "100", 10),
  },
  open: {
    browserRoots: getEnvVar("OPEN_BROWSER_ROOTS", false),
  },
  stt: {
    apiUrl: getEnvVar("STT_API_URL", false),
    apiKey: getEnvVar("STT_API_KEY", false),
    model: getEnvVar("STT_MODEL", false) || "whisper-large-v3-turbo",
    language: getEnvVar("STT_LANGUAGE", false),
    notePrompt: getEnvVar("STT_NOTE_PROMPT", false),
    // "multipart" (default) = standard OpenAI/Groq Whisper form-data upload.
    // "json" = base64 audio in an `input_audio` JSON body (e.g. OpenRouter).
    requestFormat: getOptionalSttRequestFormatEnvVar("STT_REQUEST_FORMAT", "multipart"),
  },
  docExtractor: {
    apiUrl: getEnvVar("DOC_EXTRACTOR_URL", false),
    apiKey: getEnvVar("DOC_EXTRACTOR_API_KEY", false),
  },
  tts: (() => {
    const provider = getOptionalTtsProviderEnvVar("TTS_PROVIDER", "openai");
    const defaultVoice =
      provider === "google"
        ? "en-US-Studio-O"
        : provider === "elevenlabs"
          ? "21m00Tcm4TlvDq8ikWAM"
          : provider === "edge"
            ? "en-US-EmmaMultilingualNeural"
            : "alloy";
    const defaultModel = provider === "elevenlabs" ? "eleven_flash_v2_5" : "gpt-4o-mini-tts";
    return {
      apiUrl: getEnvVar("TTS_API_URL", false),
      apiKey: getEnvVar("TTS_API_KEY", false),
      provider,
      model: getEnvVar("TTS_MODEL", false) || defaultModel,
      voice: getEnvVar("TTS_VOICE", false) || defaultVoice,
    };
  })(),
};
