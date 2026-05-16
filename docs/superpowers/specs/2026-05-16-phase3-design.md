# Phase 3 Design Spec — opencode-remote-control

> **Revised 2026-05-16** after research into the opencode SDK, plugins doc,
> and the GitHub ecosystem (grinev, OpenChamber, cc-connect, kortix-channels,
> opencode-chat-bridge, kcrommett/opencode-web, background-agents,
> vibe-coding-slack-notifier). See `2026-05-16-architecture-comparison.md`
> for the Plan A vs Plan B decision rationale.

## Goal

Take the project from "private Telegram-only bot" to "publishable v0.3.0-rc on
GitHub, SDK-native, transport-aware":

1. **Migrate to SDK-native message submission** — replace TUI-inject as the
   primary submission path with `client.session.prompt()`, the official SDK
   pattern. This unblocks per-message `agent`/`model` override and removes
   the cycle/picker workarounds.
2. **Transport abstraction** — introduce a minimal `Transport` interface with
   `Card`/`Button`/`Capabilities`, shaped so Web (Phase 5) is the next real
   consumer.
3. **Stability** — finish remaining MVP acceptance (14.2/14.11/14.12/14.13),
   persist `lastSessionId` across restarts.
4. **OSS prep** — LICENSE (MIT), SECURITY.md, public-grade README,
   `ARCHITECTURE.md`, GitHub Actions CI.

Sprint duration target: **~2 weeks**. Exit: `git tag v0.3.0-rc.1` ready for
review; repo is publishable.

Out of scope: productization (single-command launcher) → Phase 4. Web UI →
Phase 5. Discord/Feishu/Slack → cut from v1.0 roadmap.

---

## What the research changed

| Original assumption | Reality | Spec change |
|---|---|---|
| TUI inject is a reasonable primary submission path | SDK pushes `session.prompt({ parts, agent, model, noReply, format })` — TUI inject is a TUI control API, not a message API | Migrate to `session.prompt()`; keep TUI inject as `TUI_VISIBLE=true` opt-in |
| `/agent` and `/model` need workarounds because opencode has no targeted switch | Targeted switch happens **per-message** via `session.prompt({ body: { agent, model } })` — stored in bot memory, applied to every submission until changed | `/agent` lists & sets next-agent; `/model` lists & sets next-model; both effective immediately on next message, no TUI cycle, no picker |
| FAVOURITE_MODELS env var defines the list | Models are pinned per-agent in `config.agent.<name>.model` (already discovered) | `/model` lists agent-pinned models; selecting a model implicitly selects its agent for the next prompt |
| Transport is theoretical until Discord/Feishu | Web (Phase 5) is the next real consumer | Shape interface for Web specifically; drop Discord/Feishu speculation |
| OSS will draw users away from grinev | grinev has 642 stars and feature lead | Differentiate as **SDK-native reference impl + Telegram+Web from one codebase**; don't chase feature parity |

---

## Current architecture (Phase 2 baseline)

```
src/
  bot/                      ← Telegram-specific
    index.ts                wires deps, isGenerating, abort, text handler
    handlers/
      chat.ts               handleChat: TUI submit → SSE loop → replyStream
      commands.ts           slash commands (HTML cards, callbacks)
      callbacks.ts          inline-button callbacks
      approval.ts           approval event → buttons
    reply.ts                createReplyStream (throttled edit)
  opencode/
    client.ts               getClient/checkHealth (uses @opencode-ai/sdk)
    event-stream.ts         persistent SSE, .session(id) generator
    tui-bridge.ts           TUI inject + prompt_async fallback
  utils/                    markdown, logger
  config.ts                 zod env schema
  index.ts                  main loop (waitForHealth, bot.launch retry)
```

Stack: TS 5.4, Node 20, Telegraf v4, `@opencode-ai/sdk` 1.14+, Vitest, launchd.
Tests: 9 files, 51 passing.

---

## Section 1 — File tree after refactor

```
src/
  core/
    types.ts                 ← Card, Button, IncomingMessage, ChannelCapabilities
    relay.ts                 ← Channel-agnostic chat loop (SDK-native)
    state.ts                 ← Persistent SessionState (file-backed)
    agent-context.ts         ← Tracks selected agent/model for next prompt
  opencode/                  ← unchanged except tui-bridge.ts (see below)
    client.ts                unchanged
    event-stream.ts          unchanged
    tui-bridge.ts            DEMOTED: now only used when TUI_VISIBLE=true
    submit.ts                ← NEW: SDK submitPrompt wrapper (default path)
  transport/
    interface.ts             ← Transport contract
    telegram/
      index.ts               ← createTelegramTransport(config): Transport
      handlers.ts            ← commands + callbacks (Telegram-shaped)
      render.ts              ← Card → Telegraf message+inline keyboard
      reply-stream.ts        ← Throttled edit helper (moved from bot/reply.ts)
  utils/                     unchanged
  config.ts                  ← TUI_VISIBLE (default false), STATE_PATH
  index.ts                   ← loader; reads TRANSPORT (default 'telegram')
docs/
  ARCHITECTURE.md            ← Plain-language architecture explanation
  transports/
    telegram.md              ← per-transport setup
    CONTRIBUTING-NEW-TRANSPORT.md
LICENSE                      ← MIT
SECURITY.md
README.md                    ← public-facing
.github/
  workflows/ci.yml
  ISSUE_TEMPLATE/{bug,feature}.md
  PULL_REQUEST_TEMPLATE.md
```

Files removed: `src/bot/index.ts`, `src/bot/handlers/{chat,commands,callbacks,approval}.ts`, `src/bot/reply.ts`. Their logic moves into `core/` and `transport/telegram/`.

---

## Section 2 — SDK-native message submission (central change)

### Current path (deprecated)

```typescript
// src/opencode/tui-bridge.ts (today)
async submit(text, sessionId?) {
  // 1. POST /tui/select-session
  // 2. POST /tui/clear-prompt
  // 3. POST /tui/append-prompt { text }
  // 4. POST /tui/submit-prompt
  // 5. waitForBusy() — TUI may not consume; fall back to prompt_async
}
```

Problems: can't override agent/model per message, requires TUI to be running
to be useful, multiple HTTP calls per message, custom retry/fallback logic.

### New path

```typescript
// src/opencode/submit.ts (new)
import type { OpencodeClient } from '@opencode-ai/sdk'

export interface SubmitOptions {
  text: string
  sessionId: string          // explicit; relay decides which session
  agent?: string             // optional override (e.g. 'build')
  model?: { providerID: string; modelID: string }
  signal?: AbortSignal
}

export async function submitPrompt(
  client: OpencodeClient,
  opts: SubmitOptions,
): Promise<void> {
  await client.session.prompt({
    path: { id: opts.sessionId },
    body: {
      parts: [{ type: 'text', text: opts.text }],
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    },
    signal: opts.signal,
  })
  // Streaming output still comes via SSE — same loop as today.
}
```

### TUI visibility option

If user sets `TUI_VISIBLE=true`, the relay runs **both** paths:
1. `client.tui.appendPrompt({ body: { text } })` — pastes the prompt into
   the TUI's prompt buffer for visual continuity
2. `submitPrompt()` — actually executes via SDK

The TUI displays the message as if the user typed it; the agent runs in the
same session via SDK. **`/agent` and `/model` overrides work in both modes**
because they ride on the SDK call, not the TUI inject.

If user has `TUI_VISIBLE=false` (default), only the SDK call runs. The TUI on
the user's Mac will eventually show the response via its own SSE subscription
to the same opencode server. This is the recommended default.

### Why this fixes /agent and /model

- `/agent` button stores `agentContext.nextAgent = 'build'` in bot memory.
- Next user message: relay reads `nextAgent`, passes it to `submitPrompt`.
- The override applies to that one message *and persists* until reset
  (matches user mental model: "set the agent, then have a conversation in it")
- `/model` same pattern with `nextModel`.
- Pin/unpin commands set/clear these overrides.
- TUI cycle is no longer involved.

### Migration steps

1. Implement `src/opencode/submit.ts` with `submitPrompt()`.
2. Add `agentContext` (next agent/model state) into `core/state.ts`.
3. Rewrite `core/relay.ts` to call `submitPrompt()` instead of
   `tuiBridge.submit()`.
4. If `TUI_VISIBLE=true`, also call `client.tui.appendPrompt()` before
   `submitPrompt()` for visual continuity.
5. Update `/agent` to set `agentContext.nextAgent` instead of calling
   `tui.executeCommand('agent.cycle')`.
6. Update `/model` to set `agentContext.nextModel` instead of opening the
   TUI picker.
7. Delete `tui-bridge.ts`'s TUI inject submit path; keep `pickSession` and
   `getStatus` helpers (still useful).

---

## Section 3 — Transport interface

```typescript
// src/transport/interface.ts

import type { Card, IncomingMessage } from '../core/types.js'

export interface Transport {
  readonly name: string                // "telegram", "web", etc.
  readonly capabilities: ChannelCapabilities

  start(): Promise<void>
  stop(): Promise<void>

  send(chatId: string, card: Card): Promise<{ messageId: string }>
  edit(chatId: string, messageId: string, card: Card): Promise<void>
  delete(chatId: string, messageId: string): Promise<void>

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  onCommand(name: string, handler: (msg: IncomingMessage) => Promise<void>): void
  onButtonClick(handler: (data: string, msg: IncomingMessage) => Promise<void>): void
}

export interface ChannelCapabilities {
  readonly edit: boolean
  readonly maxMessageLength: number
  readonly buttons: boolean
  readonly richText: boolean
  readonly streaming: boolean   // native push (WebSocket) vs poll/edit
}
```

```typescript
// src/core/types.ts

export interface Card {
  title?: string
  lines: string[]               // HTML-ish: <b>, <i>, <code>
  buttons?: Button[][]
  footer?: string
}

export interface Button {
  label: string
  data: string                  // callback payload
}

export interface IncomingMessage {
  userId: string
  chatId: string
  text: string
  messageId: string
}
```

Shape decisions:
- HTML-ish tags in `Card.lines` (not a structured AST) — Telegram already
  consumes HTML; Web reads them as HTML; AST is overkill for v0.3.
- Buttons 2D `Button[][]` for grid layouts; non-grid transports flatten.
- No attachments in v0.3 (deferred).
- `edit()` is required; transports without true edit do `delete + send`
  internally and re-emit a new messageId via `send`.

---

## Section 4 — Core relay

```typescript
// src/core/relay.ts (skeleton)

interface RelayDeps {
  transport: Transport
  client: OpencodeClient
  eventStream: EventStream
  state: SessionState
  agentContext: AgentContext   // tracks nextAgent / nextModel
  editThrottleMs: number
  chatTimeoutMs: number
  tuiVisible: boolean
}

export function createRelay(deps: RelayDeps) {
  return async function onIncoming(msg: IncomingMessage): Promise<void> {
    const initial = await deps.transport.send(msg.chatId, thinkingCard())
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    const sessionId = await pickSession(deps.client, deps.state.getLastSessionId())
    deps.state.setLastSessionId(sessionId)

    // Optional TUI mirror
    if (deps.tuiVisible) {
      try { await deps.client.tui.appendPrompt({ body: { text: msg.text } }) }
      catch {}  // TUI not running: silently skip
    }

    // SDK submission
    await submitPrompt(deps.client, {
      text: msg.text,
      sessionId,
      agent: deps.agentContext.consume(),    // takes next-agent + clears
      model: deps.agentContext.consumeModel(),
      signal: ac.signal,
    })

    // Iterate SSE, accumulate streamed text + tool events, edit card
    // (Same iteration logic as today, but writes to transport.edit, not ctx.editMessageText)
    // ... existing loop body, refactored to use deps.transport ...
  }
}
```

Tests live in `tests/unit/relay.test.ts` with a `FakeTransport` and a
mock client. No `telegraf` imports in core tests.

---

## Section 5 — Persistent state

`src/core/state.ts` — file-backed JSON store.

```typescript
export interface SessionState {
  getLastSessionId(): string | undefined
  setLastSessionId(id: string | undefined): void
  // Phase 4 will add: getTuiSelectedSession(), getCurrentAgent()
}

export interface AgentContext {
  /** Returns next-agent and clears it (one-shot semantics removed — see note). */
  consume(): string | undefined
  consumeModel(): { providerID: string; modelID: string } | undefined
  setNextAgent(name: string | undefined): void
  setNextModel(m: { providerID: string; modelID: string } | undefined): void
  // Persisted across restarts via SessionState
}
```

**Persistence semantics:** `nextAgent` and `nextModel` are *sticky*: once set,
they apply to every subsequent message until the user changes or clears them.
This matches the user's mental model from `/agent` ("now use the build agent")
better than a one-shot override.

Storage: `STATE_PATH` env, default `./data/state.json`. Atomic write via
`*.tmp` + rename. Recover from malformed JSON by logging warning + treating
as empty.

Tests cover: round-trip, atomic rename, malformed recovery, concurrent debounced writes.

---

## Section 6 — Telegram transport implementation

`src/transport/telegram/index.ts` exports `createTelegramTransport(config): Transport`.

Internal modules:
- `handlers.ts` — slash commands + callback handlers (logic ports 1:1 from
  current `commands.ts`+`callbacks.ts`). After refactor, all command logic
  speaks `Transport` API; no direct `ctx.reply()` calls except in render layer.
- `render.ts` — `cardToTelegram(card): { text, options }`. Translates the
  channel-agnostic `Card` to Telegraf `parse_mode: 'HTML'` + inline keyboard.
- `reply-stream.ts` — throttled-edit helper (moved from `bot/reply.ts`).
  Used by relay when `capabilities.edit` is true.

Telegram-specific quirks stay inside `transport/telegram/`:
- Whitelist middleware (single-user auth)
- 409 retry on `bot.launch()`
- Fire-and-forget text handler (so /abort can interrupt)
- `isGenerating` guard

---

## Section 7 — Stability work

**Acceptance tests** (still pending from Phase 1/2):
- **14.2 — concurrent busy**: two messages, second gets "⏳ session busy" not crash.
- **14.11 — network blip**: kill+restart opencode mid-stream; EventStream
  reconnect handles it cleanly (synthetic idle fix already in).
- **14.12 — unauthorized user**: non-allowlisted user gets "Unauthorized" + log.
- **14.13 — 24h soak**: launchd exit count = 0 over 24h, no memory leak.

**Bug fixes** discovered during soak go here. Allocate ~1 day buffer.

---

## Section 8 — OSS prep

### LICENSE — MIT (year 2026)

### SECURITY.md

```markdown
# Security Policy

Report privately to <email-to-confirm>.
Acknowledge within 48h, fix within 14 days for high-severity issues.
```

### README.md (rewrite)

Target: developer goes from clone → working bot in ≤ 15 min.

Sections:
1. **What it is** — 1 paragraph
2. **How we differ from grinev/opencode-telegram-bot, OpenChamber, cc-connect** —
   honest positioning: SDK-native reference impl + Telegram+Web from one codebase.
3. **Architecture diagram** — 2-process model (your laptop runs opencode + this bot)
4. **Quick Start (Telegram)** — copy-paste steps
5. **Running as a service (macOS launchd)** — link to OPS.md
6. **Command reference** — table
7. **Multi-transport future** — link to ARCHITECTURE.md and CONTRIBUTING-NEW-TRANSPORT.md
8. **Security model** — single-user, allowlist by user id
9. **License**: MIT

### docs/ARCHITECTURE.md

Plain-language deep dive (see standalone document).

### docs/transports/telegram.md

Telegram setup deep dive: BotFather steps, common errors, troubleshooting.

### docs/transports/CONTRIBUTING-NEW-TRANSPORT.md

How to add a new transport: implement the interface, declare capabilities,
register in loader, write tests, write docs.

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

### Issue + PR templates — standard

---

## Section 9 — Implementation order

| # | Track | Task | Files | Risk | Est |
|---|---|---|---|---|---|
| 1 | SDK | Write submit.ts wrapping `client.session.prompt()` | new | low | 2h |
| 2 | SDK | Unit test: submit with/without agent/model overrides; SSE iteration unchanged | new | low | 2h |
| 3 | Arch | Create core/types.ts, transport/interface.ts (no behavior change) | new | low | 2h |
| 4 | Arch | Move bot/reply.ts → transport/telegram/reply-stream.ts | rename + imports | low | 0.5h |
| 5 | Arch | Create transport/telegram/render.ts (Card → telegram) | new | low | 2h |
| 6 | Arch | Create core/state.ts + AgentContext + tests | new | low | 4h |
| 7 | Arch | Extract handleChat → core/relay.ts, calling submitPrompt | new + delete | medium | 6h |
| 8 | Arch | Port commands.ts + callbacks.ts → transport/telegram/handlers.ts; update /agent and /model to set agentContext | move + adjust | medium | 4h |
| 9 | Arch | createTelegramTransport implements Transport interface | new + delete bot/index.ts | medium | 4h |
| 10 | Arch | Update src/index.ts loader for TRANSPORT env | one file | low | 1h |
| 11 | Stability | Run 14.2/14.11/14.12 + fix bugs | varies | medium | 1 day |
| 12 | Stability | Start 14.13 24h soak in background | n/a | low | n/a |
| 13 | OSS | LICENSE + SECURITY.md + README rewrite | docs | low | 1 day |
| 14 | OSS | docs/ARCHITECTURE.md + transports/telegram.md + CONTRIBUTING-NEW-TRANSPORT.md | docs | low | 1 day |
| 15 | OSS | .github/workflows/ci.yml + issue/PR templates | docs | low | 2h |
| 16 | Tag | 14.13 completes, final audit, tag v0.3.0-rc.1 | n/a | low | n/a |

Total: ~10 working days.

---

## Section 10 — Definition of done

- [ ] `npm test` passes — all existing tests + new tests for submit, relay, state, AgentContext
- [ ] `npx tsc --noEmit` clean
- [ ] `src/bot/` no longer exists; replaced by `src/core/` + `src/transport/telegram/`
- [ ] Default submission path is `client.session.prompt()`; TUI inject only when `TUI_VISIBLE=true`
- [ ] `/agent <name>` sets next-agent override, applied on subsequent prompts (verified by sending a message and seeing it run under that agent)
- [ ] `/model <provider/id>` sets next-model override
- [ ] `lastSessionId`, `nextAgent`, `nextModel` survive restart
- [ ] Acceptance: 14.2 / 14.11 / 14.12 pass; 14.13 — 24h without crash-restart
- [ ] LICENSE, SECURITY.md, README, docs/ARCHITECTURE.md, docs/transports/telegram.md present
- [ ] GitHub Actions CI green
- [ ] `.env.example` audited
- [ ] `git tag v0.3.0-rc.1` ready for review

---

## Risks

| Risk | Mitigation |
|---|---|
| `client.session.prompt()` semantic differences vs TUI inject (e.g., timing of SSE start) | Validate empirically in step 2 with unit + integration smoke test; document any drift |
| Removing TUI inject silently breaks existing TUI-watching users | `TUI_VISIBLE=true` opt-in preserves the visual experience for those users |
| Refactor introduces regression | Smoke checklist + 14.x acceptance suite + `npm test` ≥ 55 |
| AgentContext persistence breaks if user manually edits state.json | Treat malformed → empty; log warning. Document path in README |
| 24h soak surfaces memory leak | Heap snapshot at start + end; if growing, file bug for v0.3.1, don't block tag |

---

## Open questions (carry to user before tag)

1. **Public handle / author name** — for LICENSE and README byline
2. **Security contact email** — SECURITY.md
3. **Final project / npm name** — keep `opencode-remote-control`? Consider
   `opencode-rc` for the binary; full name as repo
4. **Telegraf vs grammy** — grinev uses grammy (more active in 2026); should
   we migrate? Recommendation: defer to Phase 4 if any pain shows up;
   telegraf still works
