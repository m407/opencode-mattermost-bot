# Mattermost integration

The application connects to Mattermost API v4 using a bot token and consumes WebSocket events. It permits exactly the configured user/channel, ignores edits/deletions/system posts for task submission, deduplicates events, and bounds the delivery backlog. REST requests have timeouts and refuse redirects so tokens cannot be forwarded to another host.

## Optional callbacks and slash command

Ordinary `!` commands work over WebSocket. Interactive buttons require an HTTPS callback endpoint reachable by the Mattermost server:

```dotenv
MATTERMOST_CALLBACK_URL=https://bot.example.com/mattermost
MATTERMOST_CALLBACK_HOST=127.0.0.1
MATTERMOST_CALLBACK_PORT=8080
MATTERMOST_CALLBACK_SECRET=a-long-random-secret-at-least-32-characters
```

The application serves `/mattermost/actions` and `/mattermost/commands` for the example URL. If your base URL has another path, that path is used instead.

**Only the trusted Mattermost server may reach the actions endpoint.** Restrict the reverse proxy by source network or mutually authenticated TLS. Configure that proxy to overwrite `X-Mattermost-Callback-Secret` with the configured secret. Never expose the backend directly or copy an untrusted client header. Mattermost does not sign action callbacks; the network restriction and proxy header authenticate their origin. For example, behind a proxy on the same host:

```nginx
location /mattermost/ {
    allow 10.20.30.40; # replace with the Mattermost server's actual source address
    deny all;
    proxy_set_header X-Mattermost-Callback-Secret "replace-with-the-configured-secret";
    proxy_pass http://127.0.0.1:8080;
}
```

Each button also carries a random, expiring, single-use token scoped to a user, channel and post. Tokens from another card or an already answered request cannot answer it. A failed API response can be retried using the text command shown on the card. Webhook payloads are limited to 64 KiB.

To enable `/opencode`, create a custom slash command in Mattermost **Integrations → Slash Commands**:

- Trigger: `opencode`
- Method: `POST`
- Request URL: `https://bot.example.com/mattermost/commands`
- Copy its generated token to `MATTERMOST_COMMAND_TOKEN` and restart the bot.

Slash requests must match that token and the configured user/channel. Use `/opencode status`, `/opencode new`, etc. For prompt text and file uploads use ordinary channel/thread posts. The bot acknowledges commands immediately and posts their result separately.

## Adapter library

`./mattermost` exports `MattermostClient`, `MattermostEvents`, `MattermostActions`, and their types. The REST client supports posts, authenticated bounded file downloads/uploads, reactions, dialogs, commands and pinning. The events client handles reconnection and filters allowed users/channels. The actions store handles callback scoping/expiry; the host application must authenticate callback origin as above.

The runnable application adds OpenCode routing, streaming, settings, sessions, scheduling, permissions and questions. Real server verification requires a configured Mattermost instance and OpenCode server; automated tests use controlled REST/WebSocket endpoints and SDK mocks.
