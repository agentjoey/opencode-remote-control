# opencode-remote-control

An [opencode](https://opencode.ai) **plugin** that lets you drive your local
opencode from **Telegram** or a **Web UI (PWA)**. Install
once; it auto-starts in-process with opencode. Send a message from your phone or
browser and watch the assistant work — even when you're away from your desk.

## How we're different

- **Runs as an opencode plugin, in-process.** One install, no extra process, no
  daemon to babysit — it starts and stops with `opencode` itself.
- **Telegram + Web from a single codebase.** The same sessions stream live to
  Telegram and a desktop PWA simultaneously; switch surfaces mid-task without
  losing context.
- **SDK-native.** Built on `@opencode-ai/sdk` and the opencode plugin event
  hook — it speaks opencode's own protocol rather than scraping a UI, so agent /
  model overrides, approvals, diffs, and cost/token metadata all come through
  first-class.
- **Transport-agnostic core.** A channel-neutral `CardBus` carries structured
  cards; each transport renders them independently. Adding a new channel
  (Discord, Slack, …) doesn't touch the relay core.
- **Local-first & single-user.** It runs on your machine against your local
  opencode server, stores state in a local file, and answers to one allowlisted
  user. No cloud, no shared backend.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  opencode (single process)                            │
│                                                       │
│  ┌──────────────────┐  ┌───────────────────────────┐ │
│  │ AI engine :4096  │  │ plugin: remote-control     │ │
│  │                  │  │  ├─ Telegraf (Telegram)    │ │
│  │   event hook ────┼──┼─►├─ Hono + WS (Web PWA)    │ │
│  │                  │  │  └─ relay + CardBus        │ │
│  └──────────────────┘  └──────────┬────────────────┘ │
│                                   ▼                   │
│                          Telegram / Web / Extension   │
└──────────────────────────────────────────────────────┘
```

The plugin loads inside opencode and is driven by the plugin **event hook**: it
submits prompts via the SDK, consumes streaming events, and renders structured
cards to whichever transports are enabled. A TUI, if you run one, is just
another client of the same opencode server.

Full deep-dive: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick Start (Telegram)

1. **Create a bot** with [@BotFather](https://t.me/BotFather), get a token.
2. **Find your user ID** — message [@userinfobot](https://t.me/userinfobot).
3. **Build and install the plugin** (opencode 1.17+):
   ```bash
   npm install && npm run build
   node dist/cli/install.js
   ```
   The installer writes a plugin bridge to `~/.config/opencode/plugins/`
   (opencode 1.17 loads local plugins from there — directory paths in
   `opencode.json` no longer work), ensures that dir's `package.json` has
   `"type": "module"`, and saves `TELEGRAM_BOT_TOKEN` / `ALLOWED_USER_IDS` /
   `WEB_ENABLED` / `WEB_PORT` to the repo's `.env`.
4. **Run opencode** from any directory — the plugin loads globally:
   ```bash
   opencode
   ```
   The plugin auto-starts. For an always-on remote-control hub, run it from a
   small/empty directory (e.g. `~/ocrc-hub`) so opencode's file watcher stays
   fast. Run only **one** instance — web (`:17081`) and the Telegram bot are
   global singletons.
5. **Send "hello"** in Telegram → the assistant responds.

## Web UI (PWA)

The Web UI runs alongside Telegram and shows the same sessions in real time
(full streaming), installable as a desktop PWA. Front it with a Cloudflare
Tunnel + Cloudflare Access for HTTPS and auth — see [`docs/OPS.md`](docs/OPS.md).

1. Set `WEB_ENABLED=true` (and `WEB_PORT` — default `17081`, since opencode's
   own server occupies `7081`).
2. Build the web app: `cd web && npm run build`.
3. The plugin serves the PWA at `http://127.0.0.1:17081`. Point your Cloudflare
   tunnel ingress at that port.
4. Behind Cloudflare Access, install it to your home screen from Chrome/Safari.

> **Cloudflare Access note:** a browser WebSocket can't carry service-token
> headers, so put `/ws` on a CF Access **Bypass** policy — the app then gates
> the socket itself with the CF cookie. Details in [`docs/OPS.md`](docs/OPS.md).

## Commands

| Command | Description |
|---|---|
| `/start` | Handshake + health check |
| `/status` | Server health, session count, pinned session |
| `/sessions` | List all sessions with pin buttons |
| `/session <id>` | Pin a specific session |
| `/files` | Files touched in the last session |
| `/diff` | Pending git diff for the session |
| `/todo` | Session todo list |
| `/context` | Tokens + cost + model for the session |
| `/agent` | Set next agent (sticky until cleared) |
| `/model` | Set next model (sticky until cleared) |
| `/current` | Show pinned session |
| `/abort` | Stop the current generation |
| `/version` | Plugin version + uptime |
| `/help` | Show this list |

Send any text to relay it into opencode.

## Push notifications

The plugin watches opencode sessions and proactively pushes summaries:

| Trigger | When | Content |
|---|---|---|
| Session finished | >60s run completes | Duration + assistant text summary (first 300 chars) |
| Test failure | Bash output contains FAIL/FAILED | Last 200 chars of output |

Rate limits: max 10 notifications/hour, 5-min cooldown per session. A session
the foreground UI just delivered is skipped (no double-ping).

## Multi-transport

Telegram and Web run simultaneously and share the same opencode session state,
relaying output to every connected channel in real time.

| Transport | Status | Notes |
|---|---|---|
| Telegram | ✅ Stable | Final-result delivery, pagination, approvals |
| Web (PWA) | ✅ | SvelteKit, full streaming, Cloudflare Access |
| Chrome Extension | ✅ | Side panel + context menu |

To add another channel, see
[`docs/transports/CONTRIBUTING-NEW-TRANSPORT.md`](docs/transports/CONTRIBUTING-NEW-TRANSPORT.md).

## Security model

- **Single-user per install.** Only the Telegram IDs in `ALLOWED_USER_IDS` can
  interact with the bot.
- **Local-first.** Runs on your machine, talks to your local opencode server,
  stores state in a local JSON file (`data/state.json`).
- **No secrets in repo.** `.env` is gitignored; `.env.example` documents every
  variable.
- **Web auth via Cloudflare Access.** The dev bypass only trusts a real loopback
  peer (never the configured bind address) and is **off by default**.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — (required) | Telegram bot token from @BotFather |
| `ALLOWED_USER_IDS` | — (required) | Comma-separated allowed Telegram user IDs |
| `OPENCODE_BASE_URL` | `http://localhost:4096` | opencode server URL |
| `CHAT_TIMEOUT_MS` | `600000` | Per-message timeout (ms) |
| `TUI_VISIBLE` | `true` | Navigate the TUI to the target session; `false` = pure direct API |
| `STATE_PATH` | `./data/state.json` | Persistent state file |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `TG_CHUNK_SOFT_LIMIT` | `3500` | Telegram message pagination soft limit |
| **Web** |||
| `WEB_ENABLED` | `false` | Enable the Web transport |
| `WEB_HOST` | `127.0.0.1` | Web bind address (keep loopback; front with a tunnel) |
| `WEB_PORT` | `17081` | Web port (opencode 1.17's own server occupies `7081`) |
| `WEB_STATIC_ROOT` | `<repo>/web/dist` | Built PWA path (resolved from the plugin dir, cwd-independent) |
| `WEB_SESSION_CACHE_SIZE` | `100` | Per-session card ring-buffer size |
| `WEB_CF_ACCESS_TEAM` | — | Cloudflare Access team name |
| `WEB_CF_ACCESS_AUD` | — | Cloudflare Access app AUD tag |
| `WEB_CF_ACCESS_DEV_BYPASS` | `false` | Bypass auth **only for a loopback socket peer** |

## opencode 1.17+ notes

opencode 1.17 changed plugin loading; this project accounts for all of it:

- **Local plugins load from `~/.config/opencode/plugins/`**, not from directory
  paths in `opencode.json`. The installer writes a bridge file there that
  re-invokes the built `dist/` (the source of truth — rebuild + restart to
  update). 1.17 also only calls functions *defined* in the loaded module, so the
  bridge wraps the plugin in a local function rather than re-exporting it.
- **Plugins run in a worker thread.** An unhandled rejection would otherwise
  crash the worker (`Worker has been terminated`), taking down the web server.
  The plugin installs absorbing guards so it survives.
- **Web runs on `17081`** because opencode's own server occupies `7081`. Point
  your tunnel ingress at `17081`.
- **Single instance.** Web (`:17081`) and the Telegram bot are global
  singletons — run one opencode for remote control, ideally from a small/empty
  directory so the file watcher stays fast.

## Testing

```bash
npm test                            # backend unit tests
npx tsc --noEmit                    # backend type-check
cd web && npm run check             # web type-check (svelte-check)
cd web && npm test                  # web unit tests
cd web && npm run build             # build PWA
```

## License

MIT — see [LICENSE](LICENSE).
