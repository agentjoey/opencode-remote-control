# Telegram Transport Setup

This guide walks through setting up the Telegram transport for
opencode-remote-control.

## 1. Create a bot with BotFather

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot` and follow the prompts.
3. Copy the **HTTP API token** (looks like `123456:ABC-DEF...`).
4. (Optional) Set bot name, description, and commands via BotFather.

## 2. Find your Telegram user ID

Message [@userinfobot](https://t.me/userinfobot) and copy your numeric ID.

## 3. Configure the bot

```bash
cp .env.example .env
# Edit .env:
# TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
# ALLOWED_USER_ID=12345678
```

## 4. Start opencode

```bash
opencode serve --port 4096
```

## 5. Start the bot

```bash
npm install
npm run build
npm start
```

You should see log output like:
```
[INFO] [main] starting, transport=telegram, opencode=http://localhost:4096
[INFO] [main] opencode healthy at http://localhost:4096
```

## Common errors

### "409 Conflict"

Another process is already polling Telegram with the same token. Stop the
other process, or use a different bot token.

### "Unauthorized"

The Telegram user ID sending messages doesn't match `ALLOWED_USER_ID`. Check
your ID with @userinfobot.

### "💭 thinking..." stuck forever

- Is `opencode serve` running?
- Is the port correct (`OPENCODE_BASE_URL`)?
- Check `data/state.json` — is `lastSessionId` pointing to a valid session?

### "No opencode sessions found"

Open the opencode TUI and start a conversation first. The bot needs at least
one session to attach to.

## Running as a launchd service (macOS)

```bash
cp deploy/ai.opencode.remote-control.telegram.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
launchctl start ai.opencode.remote-control.telegram
```

Logs:
```bash
tail -f /tmp/opencode-remote-control-telegram.log
tail -f /tmp/opencode-remote-control-telegram.err
```

## See also

- [Main README](../../README.md)
- [OPS.md](../../docs/OPS.md) — full operations manual
- [CONTRIBUTING-NEW-TRANSPORT.md](CONTRIBUTING-NEW-TRANSPORT.md) — adding a new transport
