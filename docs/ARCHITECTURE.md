# Architecture

> Plain-language explanation of how `opencode-remote-control` is structured,
> what it talks to, and how to extend it.
>
> Updated for Phase 3 architecture (v0.3.x onward). Phase 1/2 used a slightly
> different submission path — see "History" section.

## The 2-process model

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
│  └──────────────────────┘    │         │                              │
│  ┌──────────────────────┐    │         └──────────────────────────────┘
│  │ TUI (optional)       │    │                    │
│  │ - shares opencode    │    │                    ▼
│  │   server above       │    │           Telegram / Web / etc.
│  └──────────────────────┘    │
└──────────────────────────────┘
```

**Two processes:** opencode (which you already run), and us (the bot).

- **opencode** runs as `opencode serve --port 4096`. The TUI on your Mac is a
  *client* of that server, just like we are.
- **We** are an `@opencode-ai/sdk` consumer. We send prompts, listen for
  events, render output to the user via whichever transport(s) are enabled.

We don't need the TUI to be running — but if it is, we can mirror prompts
into it (see `TUI_VISIBLE` option below) so you see the conversation in both
places.

---

## Why two processes (and not a plugin)

opencode supports plugins for hooking into session/tool/message events. We
considered making this a plugin instead of a sidecar. We didn't, for two
reasons:

1. Plugins are designed as **event hooks**, not long-lived services. A
   Telegram bot needs to maintain a long-poll connection; a Web UI needs to
   serve HTTP. Neither fits the plugin lifecycle cleanly.
2. Every existing chat-bot in the opencode ecosystem (grinev, cc-connect,
   opencode-chat-bridge, kortix-channels, …) uses the external pattern. We
   follow that precedent.

See `docs/superpowers/specs/2026-05-16-architecture-comparison.md` for the
full decision record.

---

## File tree (Phase 3+ target)

```
src/
  core/                          ← channel-agnostic
    types.ts                     Card, Button, IncomingMessage, Capabilities
    relay.ts                     handleIncoming: SDK submit → SSE iterate → transport.edit
    state.ts                     SessionState + AgentContext (persistent)

  opencode/                      ← opencode-facing
    client.ts                    SDK client factory + health check
    event-stream.ts              persistent SSE subscriber; .session(id) async generator
    submit.ts                    client.session.prompt wrapper (default submit path)
    tui-bridge.ts                tui.appendPrompt mirror (only when TUI_VISIBLE=true)

  transport/                     ← user-facing
    interface.ts                 Transport contract
    telegram/
      index.ts                   createTelegramTransport(): Transport
      handlers.ts                slash commands + button callbacks
      render.ts                  Card → telegraf HTML message + inline keyboard
      reply-stream.ts            throttled-edit helper
    web/                         (Phase 5)
      …

  utils/                         markdown helpers, structured logger
  config.ts                      zod env schema
  index.ts                       loader: reads TRANSPORT, wires deps
```

---

## How a message flows

You send "implement F1 streaming" from Telegram.

1. **Telegraf** receives the text update → `transport/telegram/index.ts`
   dispatches to its registered `onMessage` handler.
2. The handler builds an `IncomingMessage` and calls `core/relay.ts`'s
   `onIncoming`.
3. The relay:
   - Sends an initial "💭 thinking…" card via `transport.send()`.
   - Picks the session: from `state.getLastSessionId()` or newest from
     `client.session.list()`.
   - Reads `agentContext.consume()` and `consumeModel()` to get any active
     overrides (set by /agent or /model).
   - If `TUI_VISIBLE=true`, mirrors prompt into the TUI via
     `client.tui.appendPrompt({ body: { text } })`.
   - Calls `client.session.prompt({ path, body: { parts, agent, model } })`
     — the SDK-native submission.
4. The relay enters its SSE loop: iterates events from
   `eventStream.session(sessionId, signal)`.
   - On `message.part.updated` → tracks text part IDs.
   - On `message.part.delta` → accumulates delta into a streaming string;
     periodically calls `transport.edit(chatId, messageId, textCard(streamed))`
     subject to `editThrottleMs`.
   - On `session.idle` or `session.status: idle` → breaks the loop.
   - On `session.error` → renders error card.
5. Final edit shows the complete assistant response; loop exits.

When you send `/agent build` instead:
- Handler updates `agentContext.setNextAgent('build')`.
- Confirmation card sent.
- Next text message uses `agent: 'build'` in `session.prompt`. **No TUI
  cycling.**

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
| `EDIT_THROTTLE_MS` | `1000` | Min interval between transport.edit calls |
| `CHAT_TIMEOUT_MS` | `600000` | Per-message timeout |
| `STREAM_OUTPUT` | `true` | Streaming on/off |
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
  start(): Promise<void>
  stop(): Promise<void>
  send(chatId, card): Promise<{ messageId }>
  edit(chatId, messageId, card): Promise<void>
  delete(chatId, messageId): Promise<void>
  onMessage(handler): void
  onCommand(name, handler): void
  onButtonClick(handler): void
}

interface ChannelCapabilities {
  readonly edit: boolean
  readonly maxMessageLength: number
  readonly buttons: boolean
  readonly richText: boolean
  readonly streaming: boolean   // native push (true) vs. periodic edit (false)
}
```

`Card` is channel-agnostic:

```typescript
interface Card {
  title?: string
  lines: string[]               // HTML-ish: <b>, <i>, <code>
  buttons?: Button[][]
  footer?: string
}
```

Transports translate `Card` to their native dialect:
- Telegram: HTML parse_mode + inline keyboard markup
- Web (Phase 5): React/Svelte component rendering

Capabilities let the relay adapt:
- `streaming: false` → relay uses `editThrottleMs` periodic edits
- `streaming: true` → relay pushes every delta immediately
- `edit: false` → relay falls back to `delete + send` for updates

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
| **us** (Phase 3+) | external SDK consumer | `session.prompt()` | yes (Phase 3 abstraction, Phase 5 Web) | Phase 5 |
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
