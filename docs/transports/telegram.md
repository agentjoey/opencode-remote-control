# Telegram Transport Setup

This guide walks through setting up the Telegram transport for
opencode-remote-control. It runs as an **opencode plugin** (in-process), so
there is no separate daemon to manage — it starts and stops with `opencode`.

## 1. Create a bot with BotFather

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot` and follow the prompts.
3. Copy the **HTTP API token** (looks like `123456:ABC-DEF...`).
4. (Optional) Set bot name, description, and commands via BotFather.

## 2. Find your Telegram user ID

Message [@userinfobot](https://t.me/userinfobot) and copy your numeric ID.

## 3. Configure

```bash
cp .env.example .env
# Edit .env:
#   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
#   ALLOWED_USER_IDS=12345678            # comma-separated for multiple users
```

The interactive `oprc init` wizard can write these for you (it also runs from
the installer).

## 4. Build and install the plugin

Requires opencode 1.17+.

```bash
npm install && npm run build
node dist/cli/install.js        # or: oprc install
```

The installer writes a plugin bridge to `~/.config/opencode/plugins/` (opencode
1.17 loads local plugins from there) and saves your `.env` values.

## 5. Run opencode

```bash
opencode                        # from any directory — the plugin loads globally
```

The plugin auto-starts. Send **"hello"** in Telegram → the assistant responds.
For an always-on hub, run `opencode` from a small/empty directory so the file
watcher stays fast. Multiple instances elect one PRIMARY to own the bot (see
[OPS.md](../OPS.md)).

## Common errors

### "409 Conflict" / bot silent
Only one process can long-poll a given bot token. Within one machine, PRIMARY
election handles this automatically. Across machines, run the bot on only one,
or use a different token per machine.

### "Unauthorized" / no response
The sending Telegram user ID isn't in `ALLOWED_USER_IDS`. Check your ID with
@userinfobot and confirm it's listed (comma-separated, no spaces).

### No sessions found
Start a conversation in opencode (TUI or web) first, or use `/new` to create one
in the active workspace.

## See also

- [Main README](../../README.md)
- [OPS.md](../OPS.md) — operations manual (restart, env vars, web/PWA, cache)
- [CONTRIBUTING-NEW-TRANSPORT.md](CONTRIBUTING-NEW-TRANSPORT.md) — adding a new transport
