# Local commands

Create `<runtime home>/local-commands/check_disk.json`:

```json
{
  "description": "Show available disk space",
  "exec": "df -h",
  "allowWhenBusy": true
}
```

Restart the bot, then send `!check_disk`. The filename defines the command name: lowercase letters, digits and underscores, up to 32 characters. Built-in names cannot be overridden. The command is added to `!help`.

Commands run in the runtime home using `/bin/sh` (or `cmd.exe` on Windows), with a 30-second timeout and bounded output. To use a project directory, put an explicit `cd /path/to/project && ...` in `exec`. `allowWhenBusy` defaults to false.

The configured user/channel can execute these commands with the bot service account's permissions. Keep this directory writable only by that account or an administrator.
