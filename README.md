# OpenCode Mattermost Bot

Run and monitor OpenCode coding tasks from a Mattermost channel or thread. The bot supports one configured user and channel, OpenCode V1/V2, streamed Markdown replies, tool progress, permission requests, questions, sessions, files, audio, and scheduled tasks.

Requires Node.js 22.14+ and a running OpenCode server. Build and type checking use **TypeScript 7.0.2**; linting uses **Oxlint 1.86.0**.

## Setup

1. Create a Mattermost bot account under **Integrations → Bot Accounts**, enable access tokens, and add the bot to your channel. Give it permission to read/write posts and upload files; enable pinning if you use the dashboard.
2. Copy `.env.example` to `.env`. Set `MATTERMOST_URL`, `MATTERMOST_BOT_TOKEN`, `MATTERMOST_ALLOWED_USER_ID`, and `MATTERMOST_CHANNEL_ID`. User/channel IDs are the native 26-character IDs, not names. The bot must be able to access both the Mattermost REST API and WebSocket endpoint.
3. Set `OPENCODE_MODEL_PROVIDER`, `OPENCODE_MODEL_ID`, `OPENCODE_SERVER_VERSION` (`v1` or `v2`), and your server URL/authentication. V1 defaults to `http://localhost:4096`; V2 defaults to `http://127.0.0.1:49374`. For V2, obtain the password using `opencode service get password`.
4. Run:

```sh
npm ci
npm run build
npm start
```

Send `!open /path/to/project`, then `!new`. Ordinary messages become prompts; replies and tool updates stay in the thread of the submitted prompt. `!help` lists commands. The bot processes only new posts from the configured user in the configured channel. Messages recovered after an outage are not automatically executed; resend them when prompted.

The CLI supports configuration and service management:

```sh
node dist/cli.js config
node dist/cli.js start
node dist/cli.js start --daemon
```

Use `node dist/cli.js --help` for the full CLI. Installed packages expose `opencode-mattermost`. Persistent state and logs live in `OPENCODE_MATTERMOST_HOME`, or the platform configuration directory for installed mode. Source mode defaults to the working directory.

## Commands

Commands start with `!`. An optional native `/opencode` command and interactive buttons are described in [Mattermost integration](docs/MATTERMOST_ADAPTER.md). Text commands work without an inbound HTTP endpoint.

| Commands                                                      | Purpose                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `!status`, `!help`                                            | Connection, project, session, model and queue status                         |
| `!projects`, `!open <path>`, `!worktree`                      | Select a project or existing Git worktree                                    |
| `!new [title]`, `!sessions`, `!recent`                        | Create or follow sessions                                                    |
| `!rename <title>`, `!messages`                                | Rename and inspect session history                                           |
| `!models [search]`, `!model <provider/model>`                 | Browse and select models                                                     |
| `!agent [name]`, `!variant [name]`                            | Select agent and reasoning variant                                           |
| `!abort`, `!detach`                                           | Abort the task, or stop following it while it continues on the server        |
| `!commands`, `!skills`, `!<custom-command> [arguments]`       | Discover and run OpenCode commands and skills                                |
| `!mcps`, `!mcps <name> on\|off`                               | Inspect and toggle MCP servers                                               |
| `!compact`, `!reload`                                         | Compact context; reload configuration on V2                                  |
| `!settings`                                                   | Thinking/tool display, footer, pinned dashboard, diff files, queue and audio |
| `!ls [path] [--page N]`, `!download <path>`, `!attach <path>` | Browse local files, send a file, attach text to the next prompt              |
| `!task <schedule> \| <prompt>`, `!tasklist`                   | Create and manage scheduled tasks                                            |
| `!permission <id> once\|always\|reject`                       | Answer an OpenCode permission request                                        |
| `!answer <id> [["answer"]]`, `!cancel <id>`                   | Answer or reject a question; one array per question                          |
| `!opencode_start`, `!opencode_stop`                           | Manage a local OpenCode process                                              |

Lists include exact text commands for selecting entries. Permission/question cards have buttons when callbacks are configured. Answers are bound to the pending request and its thread. Multi-select questions accept multiple values in their answer array; custom text is allowed only when the question permits it.

## Files, audio and queues

Upload images/PDFs directly to the channel or thread to include them in a prompt. Text files are supplied as text. Audio transcription uses `STT_API_URL`/`STT_API_KEY`; additional document formats use `DOC_EXTRACTOR_URL`. Prompt uploads are limited to ten files and 20 MiB total. `!ls`, `!download`, and `!attach` are limited to `OPEN_BROWSER_ROOTS`, including symlink resolution, and `CODE_FILE_MAX_SIZE_KB`. Local files refer to the bot's filesystem; mount the project into the container when using Docker.

`!settings queue queue` queues up to five prompts locally while a task is running. `!settings queue off` rejects prompts while busy. V2 additionally supports `!settings queue steer`, which sends input to the running session's inbox. Local queued prompts are cleared by abort, detach, project/session changes and restart. Steering input accepted by OpenCode belongs to the server session.

Configure a TTS provider in `.env`, then choose `!settings tts all` or `!settings tts auto` (audio replies to audio input). `off` disables speech. Other settings and the selected session/model persist across restarts. Pending permissions/questions and missed final responses are reconciled with OpenCode after reconnect.

Schedule examples: `!task every weekday at 09:00 | review failing tests` or `!task tomorrow at 14:00 | summarize changes`. Schedules are parsed using the selected model. Each task retains its project, model and agent. Completed scheduled tasks wait for the foreground task to finish before posting their results.

Local shell command definitions live in the runtime home's `local-commands` directory; see [local command configuration](docs/LOCAL_COMMANDS.md).

## Deployment and development

`docker compose up -d --build` runs the bot with persisted state. The host-network compose file targets Linux; use `docker-compose.desktop.yml` for desktop Docker. [Linux service setup](docs/LINUX_SYSTEMD_SETUP.md) covers systemd.

```sh
npm run lint
npm run typecheck
npm run build
npm test
npm run test:runtime
```

The runtime is in `src/mattermost`, domain services in `src/app`, and SDK/version compatibility in `src/opencode`. The transport-only adapter is exported as `./mattermost` and can be used independently. See [architecture](CONCEPT.md), [product behavior](PRODUCT.md), and [contributing](CONTRIBUTING.md).
