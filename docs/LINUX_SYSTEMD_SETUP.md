# Linux deployment

Build the project, choose a private state directory, and configure the bot:

```sh
npm ci
npm run build
export OPENCODE_MATTERMOST_HOME="$HOME/.config/opencode-mattermost-bot"
node dist/cli.js config
node dist/cli.js start --daemon
node dist/cli.js status
node dist/cli.js stop
```

The installed CLI is `opencode-mattermost`. The built-in daemon manager supports start/status/stop. For systemd supervision, use a unit such as the following, replacing paths and user with your actual installation:

```ini
[Unit]
Description=OpenCode Mattermost Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opencode
WorkingDirectory=/opt/opencode-mattermost-bot
Environment=OPENCODE_MATTERMOST_HOME=/var/lib/opencode-mattermost-bot
ExecStart=/usr/bin/node /opt/opencode-mattermost-bot/dist/cli.js start
Restart=on-failure
RestartSec=5
TimeoutStopSec=45

[Install]
WantedBy=multi-user.target
```

Create the state directory, copy your configured `.env` into it, and give the service account ownership. Save the unit as `/etc/systemd/system/opencode-mattermost-bot.service`, then run `sudo systemctl daemon-reload` and `sudo systemctl enable --now opencode-mattermost-bot`. Use foreground mode under systemd; do not add `--daemon`.

State includes `.env`, `settings.json`, `logs`, `run`, and `local-commands`. Keep it private to the service account and back it up before moving installations. The runtime needs outbound Mattermost HTTP/WebSocket and OpenCode HTTP/SSE access. Optional inbound callbacks require the protected reverse proxy in [Mattermost integration](MATTERMOST_ADAPTER.md).

Docker has container-local filesystem/process visibility. Mount project directories explicitly and set `OPEN_BROWSER_ROOTS` accordingly. Process start/stop commands are disabled in containers.
