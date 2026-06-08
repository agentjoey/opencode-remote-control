# Architecture

> Plain-language explanation of how `opencode-remote-control` is structured,
> what it talks to, and how to extend it.
>
> Updated for v0.6.0 (Plugin Registry mode as primary deployment).

## Deployment models

### Plugin mode (v0.6.0+, recommended)

```
┌──────────────────────────────────────────────────────┐
│  opencode (single process)                            │
│                                                       │
│  ┌──────────────────┐  ┌───────────────────────────┐ │
│  │ AI Engine :4096  │  │ Plugin: remote-control     │ │
│  │                  │  │  ├─ Telegraf (Telegram)    │ │
│  │                  │  │  ├─ Hono + WS (Web PWA)    │ │
│  │                  │  │  └─ relay + CardBus        │ │
│  └──────────────────┘  └──────────┬────────────────┘ │
│                                   ▼                   │
│                          Telegram / Web PWA            │
└──────────────────────────────────────────────────────┘
```

Install once: `npx opencode-remote-control install`
Then: `opencode` — bot auto-starts, no extra terminal, no launchd.

### Sidecar mode (legacy, v0.1–v0.5.7)

Same architecture as below. Set `RC_MODE=legacy` to opt out of Plugin mode
and run the standalone Node.js process.

---

## File tree (Phase 5 / v0.5.5+)

```
src/
  core/                          ← channel-agnostic
    structured-card.ts           10-variant discriminated union (thinking/think-stream/streaming/assistant/…)
                                 streaming + assistant use blocks: ContentBlock[] (text | tool in order)
    stream-accumulator.ts        SDK part.id dedup → ordered ContentBlock[] (v0.5.5+)
                                 v0.5.7: skips empty text="" upserts to prevent content erasure
    card-bus.ts                  per-session + wildcard subscribers, ring buffer
    relay.ts                     SDK submit → SSE iterate → accumulator → CardBus.publish
                                 v0.5.7: partTextAcc map for delta accumulation; thinking card
                                 published after sessionId resolved; early abort restored
    history.ts                   messageToCards, reconstructHistory (produces blocks)
    state.ts                     SessionState + AgentContext (persistent)
    push.ts                      Push notifications (60s+ sessions, test failures)
                                 v0.5.7: 3s retry on fetchSummary empty (opencode persistence race)

  opencode/                      ← opencode-facing
    client.ts                    SDK client factory + health check
    event-stream.ts              persistent SSE subscriber + 30s heartbeat reconnect
    submit.ts                    client.session.prompt wrapper
    tui-bridge.ts                tui.appendPrompt mirror (deprecated path)

  transport/                     ← user-facing
    interface.ts                 Transport contract (revised: start({cardBus,state}))
    telegram/
      index.ts                   createTelegramTransport()
      handlers.ts                slash commands + button callbacks
      renderer.ts                TelegramSessionRenderer: send-only (no edit/streaming v0.5.7)
                                 sendTimed() wraps all sendMessage with 10s TCP hang timeout
      render.ts                  legacy card→Telegram HTML (non-streaming cards)
    web/
      index.ts                   createWebTransport()
      server.ts                  Hono HTTP + static
      ws-hub.ts                  per-client WS subscription + broadcast
      middleware/cf-access.ts    Cloudflare Access JWT verification
      routes/*.ts                /api/* REST endpoints

  utils/
  config.ts                      zod env schema (WEB_* variables)
  index.ts                       starts all enabled transports

web/                             ← SvelteKit PWA + Chrome Extension
  src/
    routes/                      SvelteKit pages (+layout, +page, [sessionId])
    lib/
      ws/client.ts               auto-reconnect WebSocket client
      api/client.ts              fetch wrapper
      stores/                    sessions, activeSession, connection
      components/                Card, Composer, SessionList, …
  extension/                     Chrome MV3 manifest + background + sidepanel
  static/                        manifest.webmanifest, icons, service-worker
```

---

## How a message flows

You send "implement F1 streaming" from Telegram (or Web).

1. **Transport** receives the text update:
   - Telegram: Telegraf dispatches to `onMessage` handler.
   - Web: Hono `/api/message` route receives POST.
2. The handler builds an `IncomingMessage` and calls `core/relay.ts`'s
   `onIncoming`.
3. The relay:
   - Publishes `kind: 'thinking'` to `CardBus`.
   - Picks the session from `state.getLastSessionId()` or newest from
     `client.session.list()`.
   - Reads `agentContext.consume()` and `consumeModel()` for overrides.
   - If `TUI_VISIBLE=true`, mirrors prompt into TUI via
     `client.tui.appendPrompt({ body: { text } })`.
   - Calls `client.session.prompt({ path, body: { parts, agent, model } })`.
 4. The relay enters its SSE loop: iterates events from
    `eventStream.session(sessionId, signal)`.
    - On `message.part.updated` → feeds SDK Part into `StreamAccumulator` (dedup by `part.id`).
      Reasoning parts are internal-only (think-stream publishing disabled).
      Text/Tool parts accumulate into ordered `ContentBlock[]` and publish `kind:'streaming'`.
    - On `message.part.delta` → raw text delta is **incremental** (not full text).
      Relay tracks a `partTextAcc` Map per partId, appends deltas to baseline text
      recorded from the preceding `part.updated`, and routes the *full* accumulated
      text through accumulator. (v0.5.6 fix)
    - The accumulator guards against empty `text=""` overwrites — SDK sends empty
      text on some `part.updated` events, which would erase content for that partId.
    - On `session.idle` → publishes final `kind:'assistant'` with `blocks` and `meta`.
    - On `session.error` → publishes `kind:'error'`.
 5. **CardBus** broadcasts each `StructuredCard` to all subscribed transports.
    - Telegram (v0.5.7+ — no longer streams): `streaming` and `think-stream` cards
      are silently ignored. Only `assistant` (final result), `error`, and `info` cards
      trigger `sendMessage()`. The renderer uses `sendTimed()` — every `sendMessage`
      call has a 10s timeout via `withTimeout()` to prevent TCP hangs. Has no
      `retryEdit()` or any edit-based logic. Paginates long text into multiple messages.
    - Web: `WsHub` sends JSON frame to all subscribed WebSocket clients;
      SvelteKit frontend updates stores and re-renders components with full streaming.
 6. **Push notifications** (`src/core/push.ts`) independently monitors
    `session.idle` events from the EventStream (not relay). When a session
    finishes with >60s duration:
    - Fetches the last assistant message via `client.session.messages()`.
    - If first fetch returns empty (race with opencode persistence), waits 3s
      and retries once.
    - Extracts text parts for a summary (first 300 chars).
    - Publishes `kind:'info'` to CardBus → Telegram renderer sends a new message.
    - Rate limited: max 10/hour, 5-min cooldown per session.

When you send `/agent build` instead:
- Handler updates `agentContext.setNextAgent('build')`.
- Confirmation card sent via CardBus.
- Next text message uses `agent: 'build'` in `session.prompt`.

---

## State and persistence

The bot keeps minimal state, persisted across restarts in `data/state.json`:

```json
{
  "lastSessionId": "ses_…",
  "nextAgent": "build",
  "nextModel": { "providerID": "kimi-for-coding", "modelID": "k2p6" }
}
```

- **lastSessionId** — most recently used session; relay's default target.
- **nextAgent / nextModel** — sticky overrides; persist until cleared.
- File is written atomically (`*.tmp` + rename); corruption → treat as empty.

---

## Configuration

`src/config.ts` validates env vars via zod:

| Var | Default | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — (required) | Telegram bot token from @BotFather |
| `ALLOWED_USER_ID` | — (required) | Single allowed Telegram user id |
| `OPENCODE_BASE_URL` | `http://localhost:4096` | opencode server location |
| `TRANSPORT` | `telegram` | Active transport (Phase 5: `telegram,web`) |
| `EDIT_THROTTLE_MS` | `1000` | Min interval between transport.edit calls (**Telegram: unused since v0.5.7 — Telegram no longer edits messages**) |
| `CHAT_TIMEOUT_MS` | `600000` | Per-message timeout |
| `STREAM_OUTPUT` | `true` | Streaming on/off (**Telegram: unused since v0.5.7 — Telegram always delivers final result only; Web: still used**) |
| `TUI_VISIBLE` | `false` | Mirror prompts to TUI via appendPrompt |
| `STATE_PATH` | `./data/state.json` | Persistent state location |
| `LOG_LEVEL` | `info` | debug \| info \| warn \| error |

---

## Transport contract

Every transport satisfies:

```typescript
interface Transport {
  readonly name: string
  readonly capabilities: ChannelCapabilities
  start(deps: { cardBus: CardBus; state: SessionState }): Promise<void>
  stop(): Promise<void>
  send(chatId: string, card: StructuredCard): Promise<{ messageId: string }>
  onMessage(handler): void
  onCommand(name, handler): void
  onButtonClick(handler): void
}

interface ChannelCapabilities {
  readonly edit: boolean
  readonly maxMessageLength: number
  readonly buttons: boolean
  readonly richText: boolean
  readonly streaming: boolean   // true: push every delta; false: throttle+paginate
}
```

The relay emits `StructuredCard` to a shared `CardBus`. Each transport
subscribes to the bus and renders independently:

```typescript
type StructuredCard =
  | { kind: 'thinking';  sessionId: string; showStop: boolean }
  | { kind: 'think-stream'; sessionId: string; thinkingText: string }
  | { kind: 'streaming'; sessionId: string; blocks: ContentBlock[] }
  | { kind: 'assistant'; sessionId: string; blocks: ContentBlock[]; meta: AssistantMeta }
  | { kind: 'user';      sessionId: string; text: string; ts: number }
  | { kind: 'error';     sessionId: string; message: string }
  | { kind: 'status';    sessionId: string; fields: Record<string, string>; buttons?: Button[][] }
  | { kind: 'info';      title: string; sections: InfoSection[]; sessionId?: string }
  | { kind: 'approval';  sessionId: string; title: string; args: unknown; requestId: string }

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: string; args: string; status: 'running' | 'done' | 'error' }
```

> **v0.5.7 note:** `think-stream` publishing is currently disabled (commented out
> in relay.ts). `streaming` cards are silently ignored by Telegram renderer —
> only `assistant`, `error`, and `info` trigger sends. The `showStop` field on
> `thinking` cards is ignored — Stop button was removed entirely in v0.5.6.
> Part N headers („·done“/„·streaming…“) also removed.

Transports translate `StructuredCard` to their native dialect:
- **Telegram**: `TelegramSessionRenderer` handles per-session pagination,
  progressive tool-call collapse, and adaptive throttling.
- **Web**: `WsHub` broadcasts JSON frames; SvelteKit frontend renders
  components for each card kind.

---

## Why we use `session.prompt()` instead of TUI inject

The opencode SDK's recommended submission path is:

```typescript
await client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: 'text', text }],
    agent: 'build',                                            // per-message override
    model: { providerID: 'kimi-for-coding', modelID: 'k2p6' }, // per-message override
  }
})
```

Phase 1/2 used `tui.appendPrompt + tui.submitPrompt` ("TUI inject") because we
wanted the user's TUI window to display the message exactly as if they typed
it. That path doesn't support per-message agent/model override — which is why
our `/agent` and `/model` commands needed cycle/picker workarounds in Phase 2.

Phase 3 switches to `session.prompt()` as the default. If you want TUI
mirroring, set `TUI_VISIBLE=true` and we call `tui.appendPrompt()` (display
only) in parallel with the SDK submission.

---

## Adding a new transport

See `docs/transports/CONTRIBUTING-NEW-TRANSPORT.md` for the recipe. In short:

1. Create `src/transport/<name>/index.ts` exporting `create<Name>Transport(config): Transport`.
2. Declare `capabilities` honestly — don't claim `edit: true` if your channel
   has no message-edit primitive.
3. Implement `send/edit/delete` for messages and inline buttons.
4. Wire incoming messages → `onMessage` / `onCommand` / `onButtonClick` handlers.
5. Add `<name>` to `TRANSPORT` env parsing in `src/index.ts`.
6. Add `tests/unit/transport-<name>.test.ts`.
7. Add `docs/transports/<name>.md`.

The relay code in `src/core/relay.ts` doesn't change.

---

## Comparison with related projects

| Project | Pattern | Submission | Multi-channel | Web UI |
|---|---|---|---|---|
| **us** (v0.5.0) | external SDK consumer | `session.prompt()` | ✅ Telegram + Web | ✅ PWA + Chrome Ext |
| grinev/opencode-telegram-bot | external HTTP | TUI inject hybrid | no | no |
| cc-connect | external bridge | varies | yes (11+ platforms) | no |
| opencode-chat-bridge | external bridge | SDK | yes (Matrix/Slack/WhatsApp/…) | no |
| OpenChamber | external standalone | SDK | no | yes (multi-surface) |
| vibe-coding-slack-notifier | plugin + external CLI | hooks only | Slack only | no |

Our differentiation: **SDK-native + Telegram + Web from one codebase**.

---

## History — Phase 1/2 architecture (deprecated)

For reference, Phase 1/2 used:
- `src/bot/` instead of `src/transport/telegram/`
- `tui-bridge.ts` with TUI inject as primary submission
- No `core/` directory; relay logic was in `src/bot/handlers/chat.ts`
- `/agent` and `/model` used `tui.executeCommand('agent.cycle')` and
  `tui.openModels()` because TUI inject doesn't support per-message
  agent/model overrides

Phase 3 migrates away from this. The TUI inject path is preserved as the
`TUI_VISIBLE=true` opt-in for users who want visual continuity.
