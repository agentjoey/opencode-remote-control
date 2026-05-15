# opencode-remote-control

Sidecar Telegram bot for remote-controlling a local opencode TUI session.

This is an umbrella project. Phase 1 MVP is a Telegram bot. Future phases may add Discord, web, or native channels.

## Setup

1. Copy `.env.example` → `.env`, fill in `TELEGRAM_BOT_TOKEN` and `ALLOWED_USER_ID`.
2. `npm install`
3. `npm run build`
4. Ensure opencode TUI is running on `http://localhost:4096`.
5. `npm start` (or install as launchd service — see `deploy/`).

## Architecture

See `docs/superpowers/specs/2026-05-15-opencode-remote-control-design.md`.

## Test

```bash
npm test                  # unit tests
npm run test:integration  # contract tests against running opencode
```

## Deploy

```bash
cp deploy/ai.opencode.remote-control.telegram.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
launchctl start ai.opencode.remote-control.telegram
```
