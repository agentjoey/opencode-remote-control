# opencode-remote-control

A sidecar bot that lets you control [opencode](https://opencode.ai) from
Telegram (and eventually the Web). Run it on the same machine as your
opencode server, send messages from your phone, and watch the assistant
respond — even when you're away from your desk.

## How we're different

| Project | Pattern | Multi-channel | Web UI | SDK-native |
|---|---|---|---|---|
| **opencode-remote-control** | external SDK consumer | ✅ (Telegram now, Web planned) | Phase 5 | ✅ |
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

## Multi-transport future

The project is built around a channel-agnostic `Transport` interface. Telegram
is the first consumer; a Web UI is planned for Phase 5. If you want to add
Discord, Slack, or another channel, see
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
| `TELEGRAM_BOT_TOKEN` | — (required) | Telegram bot token |
| `ALLOWED_USER_ID` | — (required) | Allowed Telegram user ID |
| `OPENCODE_BASE_URL` | `http://localhost:4096` | opencode server URL |
| `TUI_VISIBLE` | `false` | Mirror prompts into TUI prompt buffer |
| `STATE_PATH` | `./data/state.json` | Persistent state file |
| `TRANSPORT` | `telegram` | Active transport |
| `EDIT_THROTTLE_MS` | `1000` | Min interval between message edits |
| `CHAT_TIMEOUT_MS` | `600000` | Per-message timeout (ms) |
| `STREAM_OUTPUT` | `true` | Stream output incrementally |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

## Testing

```bash
npm test            # unit tests
npx tsc --noEmit    # type-check
```

## License

MIT — see [LICENSE](LICENSE).
