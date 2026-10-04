# Product behavior

OpenCode Mattermost Bot is a single-user client for an OpenCode V1 or V2 server. One user and one channel are explicitly allowed. Each submitted prompt retains its Mattermost thread for output.

The application provides project/session navigation, model/agent/variant selection, streamed assistant text, tool and thinking output, permissions and questions, file and audio input/output, context compaction, MCP toggles, custom commands, local server management and scheduled tasks. Settings, selected session, scheduled tasks and delivered assistant IDs persist in the runtime home.

Callbacks are optional: every selection or permission/question can also be answered by a text command. Buttons require a protected HTTP callback endpoint. Only the configured user/channel can submit commands. Stale posts recovered after an outage require explicit resubmission to avoid executing old instructions.

A local queue holds up to five prompts; V2 can steer a running task through its server inbox. Abort/detach clear local queued prompts. Detach leaves the OpenCode task running. Selecting a busy session restores its status and pending questions. Disconnect recovery reconciles final responses and pending interactions against the server. Process control and file browsing apply to the bot's own host or container.

The supported configuration and command syntax are documented in [README.md](README.md). The application is not a multi-user tenant service; do not share its configured account or expose its action endpoint to arbitrary callers.
