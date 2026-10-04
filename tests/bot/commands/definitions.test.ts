import { describe, expect, it } from "vitest";
import {
  BOT_COMMANDS,
  BUILT_IN_COMMAND_NAMES,
  getLocalizedBotCommands,
} from "../../../src/bot/commands/definitions.js";
describe("command registry", () => {
  it("always exposes reload and reserves every built-in command name", () => {
    const names = BOT_COMMANDS.map((command) => command.command);
    expect(names).toContain("reload");
    expect(getLocalizedBotCommands().map((command) => command.command)).toEqual(names);
    for (const name of names) expect(BUILT_IN_COMMAND_NAMES).toContain(name);
  });
});
