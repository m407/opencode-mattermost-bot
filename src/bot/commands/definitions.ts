import type { I18nKey } from "../../i18n/en.js";
import { t } from "../../i18n/index.js";

/**
 * Centralized bot commands definitions
 * Used for Mattermost help, selection menus and local-command name reservation
 */

export interface BotCommandDefinition {
  command: string;
  description: string;
}

interface BotCommandI18nDefinition {
  command: string;
  descriptionKey: I18nKey;
}

/**
 * List of all bot commands
 * Update this array when adding new commands
 */
const COMMAND_DEFINITIONS: BotCommandI18nDefinition[] = [
  { command: "status", descriptionKey: "cmd.description.status" },
  { command: "new", descriptionKey: "cmd.description.new" },
  { command: "abort", descriptionKey: "cmd.description.stop" },
  { command: "detach", descriptionKey: "cmd.description.detach" },
  { command: "sessions", descriptionKey: "cmd.description.sessions" },
  { command: "recent", descriptionKey: "cmd.description.recent" },
  { command: "messages", descriptionKey: "cmd.description.messages" },
  { command: "settings", descriptionKey: "cmd.description.settings" },
  { command: "projects", descriptionKey: "cmd.description.projects" },
  { command: "worktree", descriptionKey: "cmd.description.worktree" },
  { command: "task", descriptionKey: "cmd.description.task" },
  { command: "tasklist", descriptionKey: "cmd.description.tasklist" },
  { command: "rename", descriptionKey: "cmd.description.rename" },
  { command: "commands", descriptionKey: "cmd.description.commands" },
  { command: "skills", descriptionKey: "cmd.description.skills" },
  { command: "mcps", descriptionKey: "cmd.description.mcps" },
  { command: "opencode_start", descriptionKey: "cmd.description.opencode_start" },
  { command: "opencode_stop", descriptionKey: "cmd.description.opencode_stop" },
  { command: "reload", descriptionKey: "cmd.description.reload" },
  { command: "open", descriptionKey: "cmd.description.open" },
  { command: "ls", descriptionKey: "cmd.description.ls" },
  { command: "help", descriptionKey: "cmd.description.help" },
  { command: "models", descriptionKey: "cmd.description.models" },
  { command: "model", descriptionKey: "cmd.description.model" },
  { command: "agent", descriptionKey: "cmd.description.agent" },
  { command: "variant", descriptionKey: "cmd.description.variant" },
  { command: "compact", descriptionKey: "cmd.description.compact" },
  { command: "download", descriptionKey: "cmd.description.download" },
  { command: "attach", descriptionKey: "cmd.description.attach" },
  { command: "permission", descriptionKey: "cmd.description.permission" },
  { command: "answer", descriptionKey: "cmd.description.answer" },
  { command: "cancel", descriptionKey: "cmd.description.cancel" },
  { command: "context", descriptionKey: "cmd.description.context" },
  { command: "revert", descriptionKey: "cmd.description.revert" },
  { command: "fork", descriptionKey: "cmd.description.fork" },
];

export function getLocalizedBotCommands(): BotCommandDefinition[] {
  return COMMAND_DEFINITIONS.map(({ command, descriptionKey }) => ({
    command,
    description: t(descriptionKey),
  }));
}

export const BOT_COMMANDS: BotCommandDefinition[] = getLocalizedBotCommands();

export const BUILT_IN_COMMAND_NAMES = [
  "start",
  "provider",
  "follow",
  ...COMMAND_DEFINITIONS.map(({ command }) => command),
];
