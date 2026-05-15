# Phase 3 Design Spec — opencode-remote-control

## Goal

Take the project from "private personal tool" to "publishable v0.3.0-rc on GitHub":

1. **Stability** — close remaining MVP acceptance items (14.2/14.11/14.12/14.13), persist `lastSessionId` across restarts, fix any bugs the soak surfaces.
2. **Architecture** — introduce a minimal `Transport` abstraction so Telegram is one of many channels (Web is the next consumer). No behavior change on the Telegram side.
3. **OSS prep** — LICENSE (MIT), SECURITY.md, public-grade README, GitHub Actions CI, `.env.example` review.

Sprint duration target: ~2 weeks. Exit: `git tag v0.3.0-rc.1` ready for review, repo is publishable.

Web UI itself (full M4) is **out of scope** here — a separate spec brainstormed after Phase 3 ships. A short high-level outline is included as Appendix A so the Transport interface is shaped with Web in mind, not Discord/Feishu speculation.

---

## Current architecture (Phase 2 baseline)

```
src/
  bot/                            ← Telegram-specific (telegraf)
    index.ts                      wires deps, isGenerating, abort, text handler
    handlers/
      chat.ts                     handleChat: TUI submit → SSE loop → replyStream
      commands.ts                 all slash commands (/status /agent /model /files ...)
      callbacks.ts                inline-button callbacks (card:dismiss, agent:cycle, model:picker, status:refresh, session:pin/unpin)
      approval.ts                 approval event → buttons
    reply.ts                      createReplyStream (throttled edit)
  opencode/                       ← server-facing, channel-agnostic
    client.ts                     SDK getClient/checkHealth
    event-stream.ts               persistent SSE, .session(id) async generator
    tui-bridge.ts                 TUI inject path + prompt_async fallback
  utils/                          markdown, logger
  config.ts                       zod env schema
  index.ts                        main loop (waitForHealth, bot.launch retry)
```

Tests: 9 files, 51 passing. Stack: TS 5.4, Node 20, Telegraf v4, `@opencode-ai/sdk` 1.14+, Vitest, launchd.

**Constraints that informed the design:**
- `src/opencode/*` is already transport-agnostic — keep it.
- `src/bot/handlers/chat.ts` mixes Telegram-specific calls (`ctx.reply`, `ctx.deleteMessage`, `replyStream.update`) with the core relay loop (SSE iteration, abort, message reconstruction). The relay logic should move to `core/`.
- `commands.ts` and `callbacks.ts` are Telegram-shaped (Markup.button.callback, parse_mode HTML). Keep them in `transport/telegram/`. The `Card` data structure lets cards be defined in a channel-agnostic way *if* a future transport (Web) wants to render them differently — but the Telegram code keeps writing Telegram cards directly until there's a reason to share.

---

## Section 1 — File tree after refactor

```
src/
  core/
    types.ts                ← Card, Button, IncomingMessage, OutgoingMessage, ChannelCapabilities
    relay.ts                ← Channel-agnostic chat relay loop (extracted from chat.ts)
    state.ts                ← Persistent lastSessionId store (file-backed)
  transport/
    interface.ts            ← Transport interface
    telegram/
      index.ts              ← Telegram transport (createTelegramTransport)
      handlers.ts           ← Slash commands + callback handlers (merged from commands.ts + callbacks.ts)
      reply-stream.ts       ← Throttled edit (moved from bot/reply.ts)
      render.ts             ← HTML card rendering helpers
  opencode/                 ← unchanged
  utils/                    ← unchanged
  config.ts                 ← add TRANSPORT (default 'telegram'), STATE_PATH (default './data/state.json')
  index.ts                  ← loader: import transport by TRANSPORT env
docs/
  ARCHITECTURE.md           ← transport abstraction explanation
  transports/
    telegram.md             ← Telegram-specific setup, env vars, troubleshooting
    CONTRIBUTING-NEW-TRANSPORT.md ← how to implement Transport for a new channel
LICENSE                     ← MIT
SECURITY.md                 ← report vulns via email
README.md                   ← rewritten for public consumption
.github/
  workflows/ci.yml          ← npm ci && npx tsc && npm test on PR + main
  ISSUE_TEMPLATE/
    bug.md
    feature.md
  PULL_REQUEST_TEMPLATE.md
```

Files removed: `src/bot/index.ts`, `src/bot/handlers/chat.ts`, `src/bot/handlers/commands.ts`, `src/bot/handlers/callbacks.ts`, `src/bot/handlers/approval.ts`, `src/bot/reply.ts`. Their logic moves into `core/relay.ts` and `transport/telegram/*`.

---

## Section 2 — Transport interface

### Minimal contract

```typescript
// src/transport/interface.ts

import type { Card, IncomingMessage } from '../core/types.js'

export interface Transport {
  /** Human-readable name, e.g. "telegram" — used in logs. */
  readonly name: string

  /** Capabilities the transport actually supports (relay reads this to decide what to do). */
  readonly capabilities: ChannelCapabilities

  /** Start listening for incoming messages and commands. */
  start(): Promise<void>

  /** Stop, drain in-flight handlers. */
  stop(): Promise<void>

  /**
   * Send a new card to a channel.
   * Returns the transport's message handle (a string id; opaque to relay).
   */
  send(chatId: string, card: Card): Promise<{ messageId: string }>

  /**
   * Edit an existing card in place. Used for streaming output and refresh-style updates.
   * If the transport doesn't support edit (capabilities.edit === false), the relay
   * falls back to send() + delete previous.
   */
  edit(chatId: string, messageId: string, card: Card): Promise<void>

  /** Delete a card by messageId. No-op if delete unsupported or already gone. */
  delete(chatId: string, messageId: string): Promise<void>

  /** Subscribe to text messages from the user. */
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void

  /** Subscribe to slash commands (or transport-native equivalent). */
  onCommand(name: string, handler: (msg: IncomingMessage) => Promise<void>): void

  /** Subscribe to button clicks. data is the callback payload, e.g. "agent:cycle". */
  onButtonClick(handler: (data: string, msg: IncomingMessage) => Promise<void>): void
}

export interface ChannelCapabilities {
  /** Can edit a previously sent message in place. Telegram: true. Email: false. */
  readonly edit: boolean
  /** Max characters per message. Telegram: 4096. */
  readonly maxMessageLength: number
  /** Inline buttons supported. Telegram: true. */
  readonly buttons: boolean
  /** Rich text (HTML or markdown). Telegram: true (HTML). */
  readonly richText: boolean
  /** Native streaming (server-push). Web/WebSocket: true. Telegram: false (uses edit). */
  readonly streaming: boolean
}
```

### Card data structure

```typescript
// src/core/types.ts

/** A renderable card. Channel-agnostic. */
export interface Card {
  /** Optional emoji+text title rendered prominently. */
  title?: string
  /** Body lines. Each transport decides how to render. Strings may contain
   * basic HTML-ish tags <b>, <i>, <code>; transports map them to their dialect. */
  lines: string[]
  /** Inline buttons. Rendered as keyboard on Telegram, as <button> on Web. */
  buttons?: Button[][]
  /** Footer/note. Rendered in italic / muted style. */
  footer?: string
}

export interface Button {
  /** Display label. */
  label: string
  /** Callback payload sent back via onButtonClick. */
  data: string
}

export interface IncomingMessage {
  /** Stable channel-side user id (Telegram user id, Web pairing id, etc). */
  userId: string
  /** Conversation id where the message was sent. For Telegram: chat_id. */
  chatId: string
  /** Raw text content. */
  text: string
  /** Channel-native message id (so the transport can reply/edit). */
  messageId: string
}

export interface OutgoingMessage {
  chatId: string
  text: string
}
```

### Decisions and tradeoffs

- **HTML-ish tags in Card.lines** instead of a structured rich-text AST. We already have HTML; Telegram uses HTML parse mode; Web can render `<b>/<i>/<code>` directly. An AST would be over-engineering for v0.3.
- **Buttons are 2D `Button[][]`** to preserve row layout intent. Transports without grids flatten to a vertical list.
- **No file/image attachment in v0.3** — defer until a transport actually needs it (Telegram doesn't for our cards; Web won't initially).
- **`edit()` is required but capability-gated.** Transports that can't edit (capability `edit: false`) implement it as `delete + send` and report a new messageId via `send`. Streaming code in `relay.ts` checks `capabilities.edit` to decide between in-place updates vs. periodic resends.

---

## Section 3 — Core relay

`core/relay.ts` extracts the channel-agnostic chat loop from `src/bot/handlers/chat.ts`. Skeleton:

```typescript
// src/core/relay.ts

import type { OpencodeClient } from '@opencode-ai/sdk'
import type { Transport } from '../transport/interface.js'
import type { Card } from './types.js'
import type { TuiBridge } from '../opencode/tui-bridge.js'
import type { EventStream } from '../opencode/event-stream.js'

interface RelayDeps {
  transport: Transport
  tuiBridge: TuiBridge
  eventStream: EventStream
  client: OpencodeClient
  editThrottleMs: number
  chatTimeoutMs: number
  streamOutput: boolean
  state: SessionState  // persistent lastSessionId store
}

export function createRelay(deps: RelayDeps) {
  return async function handleIncomingMessage(msg: IncomingMessage): Promise<void> {
    // 1. Send initial "thinking..." card
    const initial = await deps.transport.send(msg.chatId, thinkingCard())

    // 2. Set up timeout + abort
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    // 3. Submit prompt via TuiBridge
    const sessionId = await deps.tuiBridge.submit(msg.text, deps.state.getLastSessionId())
    deps.state.setLastSessionId(sessionId)

    // 4. Iterate SSE events, accumulate streamed text, edit the card
    let streamedText = ''
    const textPartIds = new Set<string>()
    let lastEdit = 0
    for await (const ev of deps.eventStream.session(sessionId, ac.signal)) {
      // ... same logic as current chat.ts but calling deps.transport.edit() ...
      if (deps.capabilities.edit && now - lastEdit >= deps.editThrottleMs) {
        await deps.transport.edit(msg.chatId, initial.messageId, textCard(streamedText))
        lastEdit = now
      }
    }

    // 5. Finalize
    await deps.transport.edit(msg.chatId, initial.messageId, textCard(streamedText || fallback))
  }
}
```

Error handling: same as today (`TuiSubmitError`, abort, timeout). The relay calls `transport.send(errorCard(reason))` instead of `ctx.reply(msg)`.

Tests: `tests/unit/relay.test.ts` with a `FakeTransport` that records calls. No telegraf imports in relay tests.

---

## Section 4 — Persistent state

`src/core/state.ts` — file-backed JSON store for `lastSessionId` (and future state like selected agent).

```typescript
export interface SessionState {
  getLastSessionId(): string | undefined
  setLastSessionId(id: string | undefined): void
}

export function createFileBackedState(path: string): SessionState { ... }
```

Implementation:
- Read `state.json` at startup, cache in memory.
- Writes are debounced (1s) — write to `state.json.tmp` then `rename` for atomicity.
- Missing file = empty state.
- Malformed file = log warning, treat as empty.

Storage path: `STATE_PATH` env, default `./data/state.json`. `.gitignore` adds `data/`.

Tests: `tests/unit/state.test.ts` — round-trip, atomicity (tmp file rename), malformed file recovery.

---

## Section 5 — Telegram transport

`src/transport/telegram/index.ts` exports `createTelegramTransport(config): Transport`.

Internal modules:
- `handlers.ts` — registers all `bot.command()` and `bot.action()` handlers. Logic ports 1:1 from current `commands.ts` + `callbacks.ts`. Slash commands forward to the relay via `transport.onCommand`. Card builders move here.
- `reply-stream.ts` — same throttled-edit helper as today's `bot/reply.ts`. Used by the relay when transport.capabilities.edit is true.
- `render.ts` — `cardToTelegram(card): { text, options }` — converts a `Card` to `{ text: string, options: { parse_mode: 'HTML', reply_markup: ... } }`. Used by `transport.send/edit`.

The Telegram-specific quirks (whitelist middleware, 409 retry, fire-and-forget text handler, isGenerating guard) stay inside `transport/telegram/` — they're not part of the channel-agnostic contract.

`createBot()` becomes `createTelegramTransport()` returning an object that satisfies `Transport`.

---

## Section 6 — Stability work

**Acceptance tests** to run/fix:
- **14.2 — concurrent busy**: two messages in flight, second should get "⏳ Session is busy" not crash. Verify isGenerating guard still works after refactor.
- **14.11 — network blip**: kill+restart opencode mid-stream, verify EventStream reconnect handles it (synthetic idle fix already in).
- **14.12 — unauthorized user**: send from non-allowlisted account, verify whitelist middleware rejects with "Unauthorized" + logs warning.
- **14.13 — 24h soak**: bot running unattended for 24h, no memory leak, no crash-restart loop. Watch `/tmp/opencode-remote-control-telegram.log`. Acceptance: launchd exit count 0 over 24h.

**New: persistent lastSessionId** — see Section 4.

**Bug fixes** discovered during soak go here. Allocate ~1 day buffer.

---

## Section 7 — OSS prep

### LICENSE — MIT

Standard MIT text, year 2026, copyright holder = the user (handle to be confirmed before publishing — see Appendix B).

### SECURITY.md

```markdown
# Security Policy

Report security issues privately to <email-to-confirm>.
Please do not open public issues for security vulnerabilities.

Response target: acknowledge within 48h, fix within 14 days for high-severity issues.
```

### README.md (rewrite)

Target: a developer who has never seen the repo can have a working Telegram bot in ≤ 15 min.

Sections:
1. **What it is** — 1 paragraph, 30-second pitch
2. **Architecture diagram** — 3-process model (your laptop, opencode TUI, opencode server, Telegram cloud, bot)
3. **Quick Start (Telegram)**
   - Prereqs: Node 20, opencode CLI installed
   - Clone, `npm install`
   - Create bot via @BotFather, get token
   - Get your Telegram user id
   - `cp .env.example .env`, fill `TELEGRAM_BOT_TOKEN` + `ALLOWED_USER_ID`
   - `npm run build && npm start`
   - Open Telegram → say hi → see opencode reply
4. **Running as a service (macOS launchd)** — link to OPS.md
5. **Command reference** — table of /status, /agent, /model, /files, /session, etc.
6. **Multi-channel future** — link to ARCHITECTURE.md and CONTRIBUTING-NEW-TRANSPORT.md
7. **Security model** — single-user-per-bot, allowlist by user id, no multi-tenant
8. **License**: MIT

### docs/ARCHITECTURE.md

Explains:
- The 3-process model
- Why `opencode serve` + TUI inject + bot
- How SSE event stream maps to message edits
- Transport interface and Card abstraction
- Where to extend for a new channel

### docs/transports/telegram.md

Telegram-specific deep dive moved here: bot creation, BotFather steps, common errors (409 Conflict, "thinking..." stuck), troubleshooting.

### docs/transports/CONTRIBUTING-NEW-TRANSPORT.md

A "how to build the next transport" guide:
- Implement the `Transport` interface
- Declare capabilities accurately
- Register in `src/index.ts` loader (TRANSPORT env switch)
- Write `tests/unit/transport-<name>.test.ts`
- Write `docs/transports/<name>.md`

### CI — `.github/workflows/ci.yml`

```yaml
name: ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test
```

### Issue / PR templates

- `bug.md` — repro steps, expected/actual, env (node, opencode version), logs
- `feature.md` — what + why + scope
- `PULL_REQUEST_TEMPLATE.md` — what changed, how tested, related issue

### `.env.example` audit

Confirm no secrets are in `.env.example`, every var has a comment, defaults are documented. Already mostly done — final pass.

---

## Section 8 — Implementation order

| Order | Task | Files | Risk | Estimate |
|-------|------|-------|------|----------|
| 1 | Create core/types.ts + transport/interface.ts (no behavior change) | core/types.ts, transport/interface.ts | low | 2h |
| 2 | Move bot/reply.ts → transport/telegram/reply-stream.ts | rename + import fix | low | 0.5h |
| 3 | Create transport/telegram/render.ts (Card → telegram format) | new | low | 2h |
| 4 | Create transport/telegram/index.ts implementing Transport (wraps current createBot) | new + delete old | medium | 4h |
| 5 | Port handlers/commands.ts + callbacks.ts → transport/telegram/handlers.ts | move + adjust imports | medium | 4h |
| 6 | Extract handleChat → core/relay.ts using Transport | core/relay.ts | medium | 4h |
| 7 | Persistent state (core/state.ts + wire to relay) | new | low | 3h |
| 8 | Update src/index.ts loader for TRANSPORT env | one file | low | 1h |
| 9 | Run 14.2/14.11/14.12 acceptance tests + fix bugs | varies | medium | 1 day |
| 10 | Start 14.13 24h soak (background, in parallel with OSS prep) | n/a | low | n/a |
| 11 | LICENSE + SECURITY.md + README.md rewrite | docs | low | 1 day |
| 12 | docs/ARCHITECTURE.md + transports/telegram.md + CONTRIBUTING-NEW-TRANSPORT.md | docs | low | 1 day |
| 13 | .github/workflows/ci.yml + issue/PR templates | docs | low | 2h |
| 14 | Final 24h soak completes, audit, tag v0.3.0-rc.1 | n/a | low | n/a |

Total: ~10 working days.

---

## Section 9 — Definition of done

- [ ] `npm test` passes — at least 51 tests still passing (existing) + new tests for relay, state, transport interface
- [ ] `npx tsc --noEmit` clean
- [ ] `src/bot/` directory no longer exists; replaced by `src/core/` and `src/transport/telegram/`
- [ ] Telegram bot behavior unchanged (smoke test: send text, /status, /agent, /model, /sessions, /files all work)
- [ ] `lastSessionId` survives `launchctl kickstart -k …` restart
- [ ] 14.2 / 14.11 / 14.12 acceptance pass
- [ ] 14.13 — bot runs 24h without crash-restart
- [ ] LICENSE, SECURITY.md, README.md, docs/ARCHITECTURE.md, docs/transports/telegram.md, docs/transports/CONTRIBUTING-NEW-TRANSPORT.md all present
- [ ] GitHub Actions CI green on this branch
- [ ] `.env.example` audited
- [ ] `git tag v0.3.0-rc.1` ready (do not tag/push until user reviews)

---

## Appendix A — Web UI high-level outline (Phase 4 preview)

> Goal of this appendix: shape the Transport interface so Web is a real consumer, not speculation. **Not** the full Web UI design — that gets its own brainstorm + spec after Phase 3 ships.

### Picture (text wireframe)

```
┌─────────────────────────────────────────────────────────────┐
│  opencode-remote-control            🟢 connected   ⚙        │
├──────────┬──────────────────────────────────────────────────┤
│ SESSIONS │  ┌────────────────────────────────────────────┐  │
│          │  │ User                                       │  │
│ • ses_…3 │  │ implement F1 streaming                     │  │
│   build  │  └────────────────────────────────────────────┘  │
│   2m ago │                                                  │
│          │  ┌────────────────────────────────────────────┐  │
│ • ses_…1 │  │ Assistant • build · gemini-3-pro           │  │
│   plan   │  │ Working through the design... ▌            │  │
│   1h ago │  └────────────────────────────────────────────┘  │
│          │                                                  │
│ + New    │  [ Send a message ]               🎙 📎 ➤      │
├──────────┴──────────────────────────────────────────────────┤
│  Approval needed: bash `rm -rf tmp/`        [Allow] [Deny] │
└─────────────────────────────────────────────────────────────┘
```

Mobile: sidebar collapses to a top hamburger; same chat area; bottom command bar.

### Interactions

- Stream text into the assistant bubble character-by-character (uses WebSocket push — `capabilities.streaming: true`, no edit-throttle hack needed)
- Tap session in sidebar → switches active session, sends `select-session` to TUI, loads message history
- `/agent` `/model` `/files` `/abort` rendered as buttons in a "command bar" (not slash text)
- Approval card slides up from bottom on mobile, modal on desktop
- Tool calls collapsed by default with `▸ ran bash` summary; tap to expand to full output

### Routing & deployment

- Bot process serves three things from same port:
  - `/api/*` — REST endpoints (start session, get history, etc.)
  - `/ws` — WebSocket transport
  - `/` — static SvelteKit build
- No separate frontend deployment; `npm start` runs everything

### Auth flow

1. User opens `https://<bot-host>/` on phone — first-visit shows "Pair this device" with a 6-digit code
2. On the desktop running the bot, the code is auto-printed to stdout and logged
3. User types the code on phone → bot validates → stores phone's device token in `state.json`
4. Future visits auto-authenticated via cookie

### Capabilities relevant to Transport interface

| Capability | Web value | Why it matters |
|------------|-----------|----------------|
| edit | true | Updates streamed text bubbles |
| maxMessageLength | unlimited (sentinel: `Number.POSITIVE_INFINITY`) | No chunking needed |
| buttons | true | Native HTML buttons |
| richText | true | Full HTML/markdown |
| streaming | true | WebSocket push, no edit-throttle |

When `capabilities.streaming` is true, the relay can push every delta immediately instead of batching via `editThrottleMs`. Telegram has `streaming: false` and continues to use throttled edits.

### What this teaches the Phase 3 Transport interface

- The `Card` model needs to accommodate "growing bubbles" — i.e., edits that append, not replace. Phase 3 keeps `edit` as full-replace (Telegram needs that anyway), and Web can implement a fast-path that diffs locally. No interface change needed.
- `capabilities.streaming` exists so transports can opt out of edit-throttling.
- Sessions sidebar needs a "list sessions" RPC — Phase 3 already has `/sessions` command that uses `client.session.list()`. No transport surface needed.
- Approval cards are buttons + payload — already in `Button` type.

### Out of scope for Phase 3

- Anything Web-specific (SvelteKit setup, WebSocket server, pairing flow, static serving)
- Anything Discord/Feishu/Slack-specific
- A `Card.rich` AST (HTML-in-strings is fine for v0.3)
- File / image attachment in Cards

---

## Appendix B — Open questions to resolve before tagging v0.3.0-rc.1

These are tracked so they get answered, not designed-around:

1. **Repo owner public handle / display name** — appears in LICENSE, SECURITY.md contact, README author line
2. **Security contact email** — for SECURITY.md
3. **Final project name** — keep `opencode-remote-control` or shorten (`oprc`)? Per roadmap, default is keep
4. **Public license year** — 2026 (Phase 3 ships in 2026-05)

---

## Risks

| Risk | Mitigation |
|------|------------|
| Refactor breaks Telegram behavior subtly | Add a smoke-test script `npm run smoke` that exercises send/edit/delete + command/callback paths against a test bot (out of scope to automate; manual checklist OK) |
| 14.13 soak surfaces a memory leak | Add heap snapshot at start + end, compare; if growing, that's its own bug ticket — don't block tag on it, document as known issue |
| Persistent state corrupts on crash | Atomic rename (.tmp → real) + recover-from-empty on parse error |
| OSS prep takes longer than estimated | Tag rc.1 with whatever docs exist; iterate to rc.2 before public — user controls timing |
