# opencode-remote-control

A sidecar bot that lets you control [opencode](https://opencode.ai) from
Telegram or a Web UI (PWA + Chrome Extension). Run it on the same machine
as your opencode server, send messages from your phone or browser, and
watch the assistant respond — even when you're away from your desk.

## How we're different

| Project | Pattern | Multi-channel | Web UI | SDK-native |
|---|---|---|---|---|
| **opencode-remote-control** | external SDK consumer | ✅ Telegram + Web | ✅ PWA + Chrome Ext | ✅ |
| grinev/opencode-telegram-bot | external HTTP bridge | ❌ | ❌ | partial |
| cc-connect | external bridge | ✅ (11+ platforms) | ❌ | varies |
| OpenChamber | external standalone | ❌ | ✅ | ✅ |

We differentiate as **the SDK-native reference implementation** that ships
Telegram + Web from a single codebase. We don't chase feature parity with
grinev; we chase architectural cleanliness and multi-transport extensibility.

## Architecture

```
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  opencode (your machine)     │         │  opencode-remote-control     │
│                              │         │  (this project)              │
│  ┌──────────────────────┐    │   HTTP  │                              │
│  │ HTTP server :4096    │◄───┼─────────┤  SDK client                  │
│  │ - /session/*         │    │   SSE   │  Event stream subscriber     │
│  │ - /event             ├────┼─────────►  Core relay loop             │
│  │ - /tui/*             │    │         │  Transport (Telegram, …)     │
│  │ - /config/*          │    │         │  Persistent state            │
│  └──────────────────────┘    │         └──────────────────────────────┘
│  ┌──────────────────────┐    │                    │
│  │ TUI (optional)       │    │                    ▼
│  │ - shares opencode    │    │           Telegram / Web / etc.
│  │   server above       │    │
│  └──────────────────────┘    │
└──────────────────────────────┘
```

**Two processes:** opencode (`opencode serve --port 4096`) and this bot.
The bot is an `@opencode-ai/sdk` consumer. It sends prompts, listens for
SSE events, and renders output to whichever transport(s) are enabled.

The TUI on your Mac is a *client* of the same opencode server — just like
we are. We don't need the TUI to be running, but if it is, you can mirror
prompts into it (see `TUI_VISIBLE` below).

Read the full architecture deep-dive in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick Start (Telegram)

1. **Create a bot** with [@BotFather](https://t.me/BotFather), get a token.
2. **Find your user ID** — message [@userinfobot](https://t.me/userinfobot).
3. **Clone & configure:**
   ```bash
   git clone https://github.com/<your-org>/opencode-remote-control.git
   cd opencode-remote-control
   cp .env.example .env
   # Edit .env: TELEGRAM_BOT_TOKEN=...  ALLOWED_USER_ID=...
   ```
4. **Install & build:**
   ```bash
   npm install
   npm run build
   ```
5. **Start opencode:**
   ```bash
   opencode serve --port 4096
   ```
6. **Start the bot:**
   ```bash
   npm start
   ```
7. **Send "hello"** in Telegram → assistant responds.

## Web UI (PWA + Chrome Extension)

The Web UI runs alongside Telegram and shows the same sessions in real time.

### PWA

1. Set `WEB_ENABLED=true` in `.env`.
2. Run `npm run build`.
3. The bot serves the PWA at `http://127.0.0.1:7081`.
4. Front with Cloudflare Tunnel + Cloudflare Access for HTTPS + auth.
5. Install to home screen from Chrome/Safari.

### Chrome Extension

1. Run `cd web && npm run build:extension`.
2. Open Chrome → Extensions → Developer mode → Load unpacked.
3. Select `web/extension-dist/`.
4. Click the extension icon → set your bot URL → open side panel.
5. Right-click any page selection → "Send to opencode" to pre-fill the composer.

See [`docs/OPS.md`](docs/OPS.md) for Cloudflare Tunnel setup.

## Running as a service (macOS)

```bash
cp deploy/ai.opencode.remote-control.telegram.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
launchctl start ai.opencode.remote-control.telegram
```

See [`docs/OPS.md`](docs/OPS.md) for logs, troubleshooting, and updates.

## Commands

| Command | Description |
|---|---|
| `/start` | Handshake + health check |
| `/status` | Server health, session count, pinned session |
| `/sessions` | List all sessions with pin buttons |
| `/session <id>` | Pin a specific session |
| `/files` | Files touched in the last session |
| `/agent` | Set next agent (sticky until cleared) |
| `/model` | Set next model (sticky until cleared) |
| `/current` | Show pinned session |
| `/abort` | Stop the current generation |
| `/help` | Show this list |

Send any text to relay it into opencode.

## Multi-transport

The project runs multiple transports simultaneously. Enable Telegram, Web, or
both — they share the same opencode session state and relay output to all
connected channels in real time.

| Transport | Status | Notes |
|---|---|---|
| Telegram | ✅ Stable | Primary channel since v0.1.0 |
| Web (PWA) | ✅ v0.5.0 | SvelteKit, Cloudflare Access |
| Chrome Extension | ✅ v0.5.0 | Side panel + context menu |

To add Discord, Slack, or another channel, see
[`docs/transports/CONTRIBUTING-NEW-TRANSPORT.md`](docs/transports/CONTRIBUTING-NEW-TRANSPORT.md).

## Security model

- **Single-user per install.** Only one Telegram user ID (`ALLOWED_USER_ID`)
  can interact with the bot.
- **No cloud.** The bot runs on your machine, talks to your local opencode
  server, and stores state in a local JSON file (`data/state.json`).
- **No secrets in repo.** `.env` is gitignored; `.env.example` documents
  every variable.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token (required for Telegram) |
| `ALLOWED_USER_ID` | — | Allowed Telegram user ID (required for Telegram) |
| `OPENCODE_BASE_URL` | `http://localhost:4096` | opencode server URL |
| `TUI_VISIBLE` | `false` | Mirror prompts into TUI prompt buffer |
| `STATE_PATH` | `./data/state.json` | Persistent state file |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| **Web** |||
| `WEB_ENABLED` | `false` | Enable Web transport |
| `WEB_HOST` | `127.0.0.1` | Web server bind address |
| `WEB_PORT` | `7081` | Web server port |
| `WEB_STATIC_ROOT` | `web/dist` | PWA static files path |
| `WEB_SESSION_CACHE_SIZE` | `100` | Ring buffer size per session |
| `WEB_CF_ACCESS_TEAM` | — | Cloudflare Access team name |
| `WEB_CF_ACCESS_AUD` | — | Cloudflare Access app AUD tag |
| `WEB_CF_ACCESS_DEV_BYPASS` | `false` | Skip JWT check on localhost |
| `WEB_CF_ACCESS_DEV_EMAIL` | `dev@localhost` | Dev bypass user email |
| **Telegram** |||
| `TG_CHUNK_SOFT_LIMIT` | `3500` | Message pagination soft limit |
| `TG_CHUNK_HARD_LIMIT` | `3900` | Message pagination hard limit |

## Testing

```bash
npm test            # root unit tests
npx tsc --noEmit    # type-check root
cd web && npm test  # web unit tests
cd web && npm run build        # build PWA
cd web && npm run build:extension  # build Chrome extension
```

## License

MIT — see [LICENSE](LICENSE).
