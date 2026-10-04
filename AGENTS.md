# AGENTS.md

Instructions for AI agents working on this project.

## About the project

**opencode-mattermost-bot** is a Mattermost bot that acts as a mobile client for OpenCode.
It lets a user run and monitor coding tasks on a local machine through Mattermost.

Functional requirements, features, and development status are in [PRODUCT.md](./PRODUCT.md).

## Technology stack

- **Language:** TypeScript 7.0.2 (build and type checking)
- **Runtime:** Node.js 22.14+
- **Package manager:** npm
- **Configuration:** environment variables (`.env`)
- **Logging:** custom logger with levels (`debug`, `info`, `warn`, `error`)

### Core dependencies

- `ws` - Mattermost WebSocket events
- Native fetch - Mattermost REST API v4
- `@opencode/client` - OpenCode V2 client
- `dotenv` - environment variable loading

### Test dependencies

- Vitest
- Mocks/stubs via `vi.mock()`

### Code quality

- Oxlint + Prettier
- TypeScript strict mode

Build and type-check with `npm run build` and `npm run typecheck`, using TypeScript
7.0.2. Run `npm run lint` for Oxlint checks with a zero-warnings policy.
Oxlint parses TypeScript independently and does not require a legacy Compiler API.
The rules in `.oxlintrc.json` retain the project's checks, including the ban on
console calls outside `src/utils/logger.ts`. Prettier handles formatting.

## Architecture

### Main components

1. **Bot Layer** - Mattermost REST/WebSocket, commands, authenticated action callbacks
2. **OpenCode Client Layer** - SDK wrapper and SSE event subscription
3. **State Managers** - session/project/settings/question/permission/model/agent/variant/keyboard/pinned
4. **Summary Pipeline** - event aggregation and Mattermost-friendly formatting
5. **Process Manager** - local OpenCode server process start, stop, and status
6. **Runtime/CLI Layer** - runtime mode, config bootstrap, CLI commands
7. **I18n Layer** - localized bot and CLI strings to multiple languages

### Data flow

```text
Mattermost User
  -> Mattermost Bot (API v4)
  -> Managers + OpenCodeClient
  -> OpenCode Server

OpenCode Server
  -> SSE Events
  -> Event Listener
  -> Summary Aggregator / Tool Managers
  -> Mattermost Bot
  -> Mattermost User
```

### State management

- Persistent state is stored in `settings.json`.
- Active runtime state is kept in dedicated in-memory managers.
- Session/project/model/agent context is synchronized through OpenCode API calls.
- The app is currently single-user by design.

## AI agent behavior rules

### Communication

- **Response language:** Reply in the same language the user uses in their questions.
- **Clarifications:** If plan confirmation is needed, use the `question` tool. Do not make major decisions (architecture changes, mass deletion, risky changes) without explicit confirmation.

### Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

### Git

- **Commits:** Never create commits automatically. Commit only when the user explicitly asks.

### Working on Windows

If your shell runs on Windows:

- Avoid fragile one-liners that can break in PowerShell.
- Use absolute paths when working with file tools (`read`, `write`, `edit`).

## Coding rules

### Language

- Code, identifiers, comments, and in-code documentation must be in English.
- User-facing Mattermost messages should be localized through i18n.

### Code style

- Use TypeScript strict mode.
- Use Oxlint + Prettier.
- Prefer `const` over `let`.
- Use clear names and avoid unnecessary abbreviations.
- Keep functions small and focused.
- Prefer `async/await` over chained `.then()`.

### Error handling

- Use `try/catch` around async operations.
- Log errors with context (session ID, operation type, etc.).
- Send understandable error messages to users.
- Never expose stack traces to users.

### Cross-platform

- The bot runs on Linux, macOS, and Windows; CI runs tests on Linux.
- Code must work on all three regardless of the OS you develop on: passing checks locally does not prove it works elsewhere.
- Code that touches paths, processes, shells, or the filesystem must work on all three: no hardcoded `\` or `/` separators, no assumptions about line endings or path case.
- Windows-only logic runs behind a `process.platform` check. A test for it either passes on every OS or is skipped outside Windows.

### Bot commands

The command list is centralized in `src/bot/commands/definitions.ts`.

```typescript
const COMMAND_DEFINITIONS: BotCommandI18nDefinition[] = [
  { command: "status", descriptionKey: "cmd.description.status" },
  { command: "new", descriptionKey: "cmd.description.new" },
  { command: "abort", descriptionKey: "cmd.description.stop" },
  { command: "sessions", descriptionKey: "cmd.description.sessions" },
  { command: "projects", descriptionKey: "cmd.description.projects" },
  { command: "rename", descriptionKey: "cmd.description.rename" },
  { command: "opencode_start", descriptionKey: "cmd.description.opencode_start" },
  { command: "opencode_stop", descriptionKey: "cmd.description.opencode_stop" },
  { command: "help", descriptionKey: "cmd.description.help" },
];
```

Important:

- When adding a command, update `definitions.ts` only.
- The same source is used for Mattermost `setMyCommands` and help/docs.
- Do not duplicate command lists elsewhere.

### Logging

The project uses `src/utils/logger.ts` with level-based logging.

Log files:

- In source mode logs are stored `<project root>/logs` by default.
- Each source-mode bot run writes to a separate file named `bot-YYYY-MM-DD_HH-MM-SS_<pid>.log`.
- The `logs/` directory is gitignored, so search inside it directly: use `path: "logs"` with `pattern: "*.log"`.
- Installed mode writes under the installed app home `logs` directory and uses daily files named `bot-YYYY-MM-DD.log`.

Levels:

- **DEBUG** - detailed diagnostics (callbacks, keyboard build, SSE internals, polling flow)
- **INFO** - key lifecycle events (session/task start/finish, status changes)
- **WARN** - recoverable issues (timeouts, retries, unauthorized attempts)
- **ERROR** - critical failures requiring attention

Use:

```typescript
import { logger } from "../utils/logger.js";

logger.debug("[Component] Detailed operation", details);
logger.info("[Component] Important event occurred");
logger.warn("[Component] Recoverable problem", error);
logger.error("[Component] Critical failure", error);
```

Important:

- Do not use raw `console.log` / `console.error` directly in feature code; use `logger`.
- Put internal diagnostics under `debug`.
- Keep important operational events under `info`.
- Default level is `info`.

## Testing

### What to test

- Unit tests for business logic, formatters, managers, runtime helpers
- Integration-style tests around OpenCode SDK interaction using mocks
- Focus on critical paths; avoid over-testing trivial code

### Test structure

- Tests live in `tests/` (organized by module)
- Use descriptive test names
- Follow Arrange-Act-Assert
- Use `vi.mock()` for external dependencies

## OpenCode SDK quick reference

The bot supports OpenCode V2 only. `src/opencode/v2/` wraps `@opencode/client`; `src/opencode/types.ts` defines bot domain values. Use the inferred client type so unsupported methods fail type checking.

```typescript
import { opencodeClient } from "./opencode/client.js";

await opencodeClient.global.health();
await opencodeClient.project.list();
await opencodeClient.session.create({ directory: "/project", title: "My session" });
await opencodeClient.session.promptAsync({
  sessionID: "session-id",
  parts: [{ type: "text", text: "Implement feature X" }],
});
await opencodeClient.session.abort({ sessionID: "session-id" });

const events = await opencodeClient.global.event();
for await (const event of events.stream) {
  // handle normalized global SSE event
}
```

## Workflow

1. Read [PRODUCT.md](./PRODUCT.md) to understand scope and status.
2. Inspect existing code before adding or changing components.
3. Align major architecture changes (including new dependencies) with the user first.
4. Add or update tests for new functionality.
5. After code changes, run quality checks: `npm run build`, `npm run lint`, `npm run typecheck`, and `npm test`.
6. Update checkboxes in `PRODUCT.md` when relevant tasks are completed.
7. Keep code clean, consistent, and maintainable.
