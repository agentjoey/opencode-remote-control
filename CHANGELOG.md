# Changelog

## Unreleased

### Added
- **Token auth, end-to-end** — the web app captures a pairing token (`#token=…`)
  on load, persists it to localStorage, strips it from the address bar, and
  attaches it to every API request (`Authorization: Bearer`) and WebSocket
  connect (`?token=`). Pairing now works **without Cloudflare Access**,
  completing the P2 goal of decoupling auth from CF Access.
- **Auto-detect the Cloudflare Tunnel hostname for `/pair`** — when
  `WEB_PUBLIC_URL` is unset, scan `~/.cloudflared/*.{yml,yaml}` for an ingress
  hostname mapped to the web port and emit that HTTPS URL instead of an
  unreachable LAN IP. Resolution order: `WEB_PUBLIC_URL` > cloudflared hostname >
  LAN IP > loopback.

### Docs
- README / OPS: token-default auth, device pairing, and **remote access without
  a domain** (Tailscale, cloudflared quick tunnel, or SSH port-forward).

## v0.6.0 — 2026-06-12

Headline: **multi-instance ready**. A single-machine fleet of opencode instances
now elects one PRIMARY to own the global web/Telegram singletons; the web/bot can
switch between workspaces; auth and public exposure are pluggable (no longer
Cloudflare-Access-only); and the web chat got a substantial UX pass.

### Added — Multi-instance foundation (P1)
- **PRIMARY election** (`src/core/primary-election.ts`) — atomic lock file
  (`~/.opencode/oprc-primary.lock`, `openSync(path,'wx')`) elects one instance to
  own the global web/Telegram singletons; others stand down PASSIVE. Stale-PID
  reclaim; lock released on construction failure or shutdown.
- **Cross-workspace global event stream** (`src/opencode/global-events.ts`) —
  `startGlobalEvents()` subscribes `client.global.event()` with reconnect, so the
  PRIMARY observes events from sibling workspaces over HTTP.
- Plugin entry gates web/bot on election; the per-instance `event` hook remains
  the in-worker dispatch source (the global stream does not deliver inside the
  plugin worker — see `docs/decisions/2026-06-12-cross-workspace-streaming.md`).

### Added — Pluggable connectivity & auth (P2)
- **Auth strategies** (`src/connectivity/auth/`) — `WEB_AUTH=token` (default) or
  `cf-access`. `TokenAuth` generates/persists an app token (0600 at
  `~/.opencode/oprc-token`), verifies HTTP + WS with `timingSafeEqual`. CF Access
  is now optional, decoupled from transport.
- **Exposure provider** (`src/connectivity/exposure/`) — `resolvePublicUrl()`
  prefers `WEB_PUBLIC_URL` > physical LAN > loopback.
- **Device pairing** (`src/connectivity/pairing.ts`) — `oprc pair` / `/pair`
  emit a QR + URL (token in the URL fragment) to onboard a device.

### Added — Workspace UX (P3)
- **Workspace switcher** — `GET /api/workspaces`, sidebar switcher; sessions
  filter to the active workspace.
- **Create session in a workspace** — `POST /api/session`; Telegram `/new`.
- **`/workspaces`** Telegram command lists known workspaces.
- **Custom commands in the web command palette** — `GET/POST /api/commands`
  run opencode custom commands against the active session (⌘K).
- **Session rename** — inline rename in the web sidebar +
  `POST /api/sessions/:id/rename` + Telegram `/rename`.

### Added — Web chat UX
- **Syntax highlighting** — highlight.js + marked-highlight; inline `` `code` ``
  renders green (file/command/path), fenced code blocks get full multi-color
  highlighting (keywords purple, functions yellow, classes cyan, numbers orange,
  comments gray, strings green).
- **GFM table rendering** — markdown tables now styled (borders, header band,
  zebra rows, horizontal scroll).
- **Top search box** — replaces the top-bar session ID; opens the command
  palette (sessions + commands), matching ⌘K.
- **Session status dots** — solid green = connected + recently active, blinking
  green = a turn is streaming, hollow gray = disconnected/inactive.
- **De-emphasized in-progress streaming** — thinking/streaming text renders
  smaller and gray; the finalized answer stays full-size.
- **Redesigned system cards** — compact status/approval/abort/info cards;
  approval buttons are filled (Allow / Always / Reject).
- **Enter-to-send** — Enter sends, Shift+Enter newlines (IME-safe).

### Fixed
- Restore the per-instance event hook as the in-worker dispatch source after P1
  routed dispatch through the global stream (which delivers zero events inside
  the worker) — this had broken web/Telegram message receipt and streaming.
- Adopt externally-initiated turns in the relay so TUI- and command-initiated
  turns stream to the web (previously dropped for lack of a session ctx).
- `theme.css` syntax colors were dropped because `:global()` is Svelte-only and
  invalid in plain CSS — rewrote the 25 hljs rules without it.
- Default `WEB_PORT` to `17081` (was `7081`, opencode 1.17's own server port).
- Telegram `ws:set` callback exceeded the 64-byte limit (short-token map);
  `notify` tool uses the tool context's `sessionID`.

### Docs
- `docs/decisions/2026-06-12-cross-workspace-streaming.md` — records that
  cross-workspace *streaming* is not supported with current opencode (worker SSE
  doesn't deliver; sessions are directory-bound). Accepted as a known limit.

---

## v0.6.0-rc.1 — 2026-05-31

### Added
- **Plugin Registry mode** — `npx opencode-remote-control install` deploys as
  opencode plugin; Telegram bot + Web PWA auto-start with `opencode`
- `src/plugin/entry.ts` — Plugin entry exporting `remoteControlPlugin: Plugin`
- `src/plugin/config.ts` — Plugin-mode config loader (openCode env + process.env)
- `src/cli/install.ts` — interactive/CI-friendly plugin installer (`--yes`, `--local`)
- `src/cli/uninstall.ts` — remove plugin from opencode config
- `rc-status` tool — status command visible in opencode TUI
- `relay.handleEvent()` — event-hook compatible event dispatch for Plugin mode
- `@opencode-ai/plugin` dependency
- `package.json` exports `./plugin`, `./install`, `./uninstall`

### Changed
- Relay deps: `eventStream` and `baseUrl` are now optional (Plugin mode compatible)
- Transport constructors: `baseUrl` and `eventStream` are now optional
- `ARCHITECTURE.md` — Plugin mode as primary deployment, sidecar as legacy
- `package.json` — removed `engines.node` restriction (Bun compatibility)

### Deprecated
- launchd deployment — replaced by Plugin auto-start
- `src/launcher/` — opencode itself is the launcher in Plugin mode
- `src/index.ts` legacy path — use `RC_MODE=legacy` to opt back in

## v0.5.7 — 2026-05-21

### Removed
- **Telegram streaming** — `renderStreaming()`, `renderThinking()`, `retryEdit()`,
  all throttling/chunking logic deleted. Telegram now delivers final result only
  via `sendMessage()`. Web transport keeps streaming unchanged.

### Fixed
- **SessionId mismatch with thinking card** — thinking card now published after
  `sessionId = resolvedId`, ensuring the sessionId in the card is always the
  correct resolved one. Early `setActiveAbort` restored for pre-submit abort.
- **Delta accumulation** — `message.part.delta` sends incremental text (not full).
  Relay now tracks `partTextAcc` Map per partId, appends deltas, and passes the
  full accumulated text to the accumulator. Root cause of truncated responses.
- **Empty text overwrite** — accumulator skips `text=""` updates when block
  already has non-empty text (SDK sends empty on some `part.updated` events).
- **TCP hang** — all sendMessage calls now have 10s timeout via `withTimeout()`/
  `sendTimed()`. Previously stuck connections hung forever.
- **429 retry_after cap** — capped at 5s; longer cooldowns force immediate
  fallback to sendMessage instead of prolonged retries.
- **push.ts fetchSummary race** — retries after 3s if first attempt returns empty
  (opencode persistence race on session idle).

### Changed
- **finalize() error handling** — catches all errors, logs them, and attempts a
  last-resort sendMessage with truncated text (3800 chars). Previously fatal
  errors silently dropped responses.
- **Thinking card** — no more `showStop` functionality (Stop button removed).
- **UI cleanup** — Stop button removed from thinking/streaming cards; Part N
  headers („·done“/„·streaming…“) removed; continuation shows just „⏳“.
- **sendInfo retries** — 3 attempts with 2s delay for ECONNRESET/ETIMEDOUT.

## v0.5.6 — 2026-05-20

### Fixed
- **Delta accumulation** — `message.part.delta` sends incremental text, not full text.
  Relay now tracks `partTextAcc` per partId, appends deltas to baseline, and passes
  the full accumulated text to the accumulator. This was the root cause of truncated/
  partial assistant responses in Telegram.
- **finalize() robust fallback**: `retryEdit()` now returns boolean. If Telegram
  edit fails, `finalize()` falls back to `sendMessage()` instead of silently
  dropping the response.
- **TCP hang protection**: all `sendMessage` and `editMessageText` calls now have
  10s timeouts via `withTimeout()` helper and `sendTimed()` wrapper method.
  Previously stuck TCP connections caused `retryEdit` and fallback `sendMessage`
  to hang forever.
- **push.ts timing race**: `fetchSummary()` retries after 3s if the first
  attempt finds no assistant message (opencode server may not have persisted it
  yet).

### Changed
- **Remove Stop button** — streaming/thinking messages no longer include ⏹ Stop
  inline keyboard.
- **Remove Part N headers** — pagination chunks no longer show `Part N · done` or
  `Part N · streaming…` prefixes. New continuation chunk shows just `⏳`.

## v0.4.0-rc.1 — 2026-05-16

### Added
- **Single-command launcher** — `oprc` (or `opencode-remote-control`) spawns
  opencode if needed, waits for health, then starts the bot. Handles
  SIGINT/SIGTERM clean shutdown of both processes.
- **Subprocess management** — `SPAWN_OPENCODE=true` auto-starts `opencode serve`
  with exponential backoff on crashes (2s→4s→8s→16s→30s), SIGTERM→SIGKILL
  fallback, and log capture to `LOG_DIR`.
- **Multi-user allowlist** — `ALLOWED_USER_IDS=a,b,c` accepts comma-separated
  Telegram user IDs. Backward-compatible with legacy `ALLOWED_USER_ID`.
- **TUI ↔ Bot state sync** — bot tracks the TUI's selected session and current
  agent in realtime via SSE events, with 5s polling fallback.
- **Info commands** — `/diff` (per-file patch preview), `/todo` (status markers ✓/▶/○),
  `/context` (agent, model, tokens, cost with next-override display).
- **Inline tool calls** — streaming cards show `▸ bash · cmd`, `▸ read · path`,
  `▸ grep · pattern` lines (configurable via `TOOL_CALLS_INLINE`).
- **Push notifications** — pushes to Telegram when: (a) a task runs >60s then
  finishes, (b) a test failure is detected in bash output. Rate-limited to
  10/hour with per-session 5min cooldown.
- **Inline Stop button** — all streaming/thinking cards include a ⏹ Stop button
  that immediately aborts the current generation.
- **Cost footer** — every assistant response shows `💰 $X.XX · ↑in ↓out · agent · model`.
  `/status` aggregates daily session costs.
- **Init wizard** — `npx -y opencode-remote-control init` interactively
  prompts for bot token, user IDs, and spawn preference, tests Telegram
  connectivity, writes `.env`.
- **CLI binary** — `oprc` (shortcut for `opencode-remote-control`).
- **Two-step `/model` picker** — select provider, then model; avoids
  Telegram's 4000-char message limit.
- **launchd plist + install/uninstall scripts** for macOS background service.

### Changed
- `/context` now shows pending next-agent and next-model overrides.
- `/help` and `setMyCommands` now include `/diff`, `/todo`, `/context`.
- Approval handler supports both v1 (`permission.updated`) and v2
  (`permission.asked`) event types with compatible field mapping
  (`title`↔`permission`, `permissionID`↔`requestID`, `response`↔`reply`).
- `.env.example` now documents `TOOL_CALLS_INLINE` and `PUSH_TEST_FAILURES`.

### Fixed
- Approve requests correctly push to Telegram bot regardless of opencode
  server version (v1 or v2 event schema).

## v0.3.0-rc.1 — 2026-05-16

### Added
- **SDK-native submission** — default path is now `client.session.prompt()`;
  TUI inject is optional (`TUI_VISIBLE=true`)
- **Transport abstraction** — `Transport` interface with `Card`/`Button` types;
  Telegram is the first implementation
- **Persistent state** — `data/state.json` stores `lastSessionId`, `nextAgent`,
  `nextModel` across restarts
- **Per-message agent/model override** — `/agent` and `/model` set sticky
  overrides applied to subsequent prompts (no more TUI cycle/picker)
- **New env vars** — `TUI_VISIBLE`, `STATE_PATH`, `TRANSPORT`
- **OSS docs** — `LICENSE` (MIT), `SECURITY.md`, public `README.md`,
  `docs/ARCHITECTURE.md`, per-transport docs
- **CI** — GitHub Actions workflow (`npm ci`, `npx tsc --noEmit`, `npm test`)
- **Issue/PR templates**

### Changed
- Restructured `src/bot/` → `src/core/` + `src/transport/telegram/`
- Moved `src/bot/reply.ts` → `src/transport/telegram/reply-stream.ts`

### Removed
- `src/bot/` directory and all its contents (replaced by new architecture)
- Obsolete unit tests for old handlers

## v0.2.0 — 2026-05-15

### Added
- `/files` command showing file operations from session messages
- `/session` pin/unpin with inline buttons
- Cardified commands (`/status`, `/start`, `/help`, `/current`)
- Callback handler framework

## v0.1.0 — 2026-05-14

### Added
- Initial MVP: Telegram bot relaying to local opencode TUI
- SSE event stream subscriber
- TUI inject submission path
- Approval flow with inline buttons
- launchd deployment
