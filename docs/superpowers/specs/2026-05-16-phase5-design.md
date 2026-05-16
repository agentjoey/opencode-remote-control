# Phase 5 — Web UI + Streaming Overflow Fix (Design Spec)

> **Status:** Approved 2026-05-16. Supersedes `2026-05-16-phase5-web-ui-outline.md`.
> **Target tag:** `v0.5.0`
> **Depends on:** Phase 4 (v0.4.0-rc.1) + Phase 4.5 OSS prep wrap-up.

## Goal

1. Add a browser-based transport (PWA + Chrome Extension) sharing one
   SvelteKit codebase, served from the bot process, fronted by Cloudflare
   Tunnel + Cloudflare Access.
2. Refactor the relay into a transport-agnostic core (`CardBus` + structured
   intermediate cards) so Telegram and Web render from the same upstream.
3. Solve the Telegram streaming truncation problem with live multi-message
   pagination and progressive tool-call collapse.

## Decisions (locked)

| Dimension | Decision |
|---|---|
| Scope | PWA + Chrome Extension (both in v0.5.0) |
| Repo layout | `web/` subdirectory, independent Vite build |
| Auth | Cloudflare Access — trust `Cf-Access-Jwt-Assertion` JWT |
| Cross-transport sync | Full bidirectional (Telegram + Web view same opencode session) |
| Render model | Refactor relay to emit `StructuredCard`; each transport renders independently |
| Session model | Bot-touched subset (from `state.json`), switchable, not creatable from Web |

## Non-goals (Phase 5)

- Voice / image attachments
- Multi-user (still single user per install)
- New opencode session creation from Web
- Firefox / Safari / Edge extensions (Chrome only, PR welcome later)
- VS Code extension
- Discord / Feishu / Slack transports
- Search / history filters

---

## Section 1 — Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│   opencode (localhost:4096)                                         │
│   HTTP + SSE                                                        │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ SDK + SSE
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│   opencode-remote-control (bot process)                             │
│                                                                     │
│   ┌─────────────┐  ┌─────────────────────────────────────────────┐ │
│   │  EventStream│──▶  core/relay.ts (refactored)                 │ │
│   │  (1 conn)   │  │  emits StructuredCard via CardBus           │ │
│   └─────────────┘  └─────────┬──────────────────┬────────────────┘ │
│                              │                  │                  │
│                              ▼                  ▼                  │
│                    ┌──────────────────┐ ┌──────────────────┐       │
│                    │ Telegram         │ │ Web              │       │
│                    │ Renderer per     │ │ - Hono HTTP/WS   │       │
│                    │ chatId × session │ │ - CardEmitter    │       │
│                    └──────────────────┘ └────────┬─────────┘       │
└──────────────────────────────────────────────────┼─────────────────┘
                                                   │ WSS
                              ┌────────────────────┼─────────────────┐
                              │  Cloudflare Tunnel + Access          │
                              └────────────────────┼─────────────────┘
                                                   ▼
                                   ┌───────────────────────────┐
                                   │  PWA  /  Chrome Extension │
                                   │  (SvelteKit shared app)   │
                                   └───────────────────────────┘
```

Key invariants:
- Single `EventStream` SSE connection per opencode server, shared across transports.
- `StructuredCard` is the universal intermediate format — no transport knows
  about another transport's rendering.
- Each transport implements `Transport` (revised — see Section 8.4).
- Web transport runs in the same Node process as Telegram.

---

## Section 2 — `StructuredCard` Data Model

`src/core/structured-card.ts`:

```typescript
export type StructuredCard =
  | { kind: 'thinking';  sessionId: string;  showStop: boolean }
  | { kind: 'streaming'; sessionId: string;  markdownSrc: string;  tools: ToolCall[] }
  | { kind: 'assistant'; sessionId: string;  markdownSrc: string;  tools: ToolCall[];
                         meta: AssistantMeta }
  | { kind: 'user';      sessionId: string;  text: string;  ts: number }
  | { kind: 'error';     sessionId: string;  message: string }
  | { kind: 'status';    sessionId: string;  fields: Record<string, string>;
                         buttons?: Button[][] }
  | { kind: 'info';      title: string;      sections: InfoSection[] }
  | { kind: 'approval';  sessionId: string;  title: string;  args: unknown;
                         requestId: string }

export interface ToolCall {
  tool: string
  args: string
  status: 'running' | 'done' | 'error'
}

export interface AssistantMeta {
  agent?: string
  model?: string
  cost?: number
  tokens?: { input: number; output: number; cache?: number }
}

export interface InfoSection {
  heading?: string
  body: string             // markdown
  code?: { language?: string; content: string }
}
```

Note: `streaming` and `assistant` stay separate kinds. Streaming pushes
incrementally; on `session.idle` relay emits a final `assistant` card with
populated `meta`, which Telegram and Web treat as "commit final state".

---

## Section 3 — Telegram Streaming Overflow Strategy

Solves: long thinking runs currently overflow 4000 chars and truncate the
final answer.

### 3.1 Data layer fix

`tools[]` and `markdownSrc` are separate in `StructuredCard` (no more
string concatenation of tool lines into assistant text).

### 3.2 Budget allocation per Telegram chunk

```
TG_MAX               = 4000
RESERVE_META         = 200                          // header + footer + sep lines
RESERVE_ANSWER_FRAC  = 0.7
CHUNK_SOFT_LIMIT     = 3500                         // soft trigger for pagination
CHUNK_HARD_LIMIT     = 3900                         // hard cutoff
TOOLS_BUDGET (per chunk)  = (TG_MAX - RESERVE_META) * (1 - RESERVE_ANSWER_FRAC) ≈ 1140
ANSWER_BUDGET (per chunk) = (TG_MAX - RESERVE_META) * RESERVE_ANSWER_FRAC      ≈ 2660
```

Both limits configurable via `TG_CHUNK_SOFT_LIMIT` / `TG_CHUNK_HARD_LIMIT`.

### 3.3 Progressive collapse (within a chunk)

Tool list display rules (computed at each render — underlying `tools[]`
stays complete):

| Tool count | Display |
|---|---|
| ≤ 7 | All visible |
| 8–15 | First 2 + last 5; middle `… N more tool calls` |
| > 15 | First 1 + last 4; `… N more` |

Currently-`running` tool entries are pinned into the "last" bucket.

Answer text rules:
- ≤ `ANSWER_BUDGET`: show in full.
- > `ANSWER_BUDGET` and still within current chunk: keep tail (latest
  output), prefix `…`.
- Exceeding chunk hard limit triggers pagination (3.4).

### 3.4 Live multi-message pagination

Maintained in `TelegramSessionRenderer` (Section 8.5). Triggered at the
throttle boundary (every 250–1000 ms — see 3.5):

```
if renderedLen(currentChunk) >= CHUNK_HARD_LIMIT:
    paginate (force, even mid-code-block)
elif renderedLen(currentChunk) >= CHUNK_SOFT_LIMIT and at natural boundary:
    paginate
```

Natural boundaries (priority order):
1. `session.idle` (final flush — always)
2. Tool call transition `state.status === 'done'`
3. Markdown paragraph `\n\n`
4. Line `\n`
5. Hard limit force-cut anywhere

Pagination atomic operation:
```
1. current chunk's Telegram message:
   - remove Stop button
   - update header → "Part k · done"
   - mark not-editable
2. send new Telegram message:
   - header "Part k+1 · streaming…"
   - include Stop button (callback data carries sessionId)
3. renderer flips activeMessageId to the new message
4. tools[] and markdownSrc tracked per-chunk (don't carry over)
```

On final `session.idle`, the active chunk gets the `AssistantMeta` footer
(cost / tokens / agent / model). All earlier chunks stay as Part 1 … Part k-1.

### 3.5 Adaptive throttling

`editThrottleMs` is replaced with adaptive logic in the renderer:

```
firstDeltaInChunk: edit immediately
nextNDeltas (n=5): throttle 250 ms
afterStable:       throttle 1000 ms
on tool completion: edit immediately (status change is high-signal)
```

### 3.6 Edge cases

| Case | Behavior |
|---|---|
| Stop pressed on Part 2 | Abort fires; that chunk's header → `· aborted` |
| Code block spanning chunk boundary | Hard-limit triggers strong split; next chunk prefixes `(continuing code block)` and re-opens ` ``` ` |
| Network error mid-stream | Current chunk header → `· error`; footer shows error message |
| Telegram 429 rate limit | Renderer parses `retry-after`, pauses all edits for that duration; CardBus buffers cards (no loss) |
| Empty assistant response | Final card lines = `(empty response)` (existing behavior preserved) |

### 3.7 Web rendering

Web has no length limit. Frontend receives the full card stream and
ignores `chunkIndex` (a renderer-internal concept). Tool list is collapsed
behind `▸ N tool calls (M running)` with click-to-expand. Auto-scroll
follows the latest content; once user scrolls up, auto-scroll pauses and a
"↓ N new messages" pill appears at the bottom.

---

## Section 4 — Web Transport (server side)

### 4.1 File layout

```
src/transport/web/
  index.ts             ← createWebTransport(): Transport
  server.ts            ← Hono server (static + /api + /ws)
  ws-hub.ts            ← WS connection registry; subscribe/broadcast
  card-emitter.ts      ← StructuredCard → JSON message frame
  middleware/
    cf-access.ts       ← CF Access JWT verification
  routes/
    auth.ts            ← GET  /api/me
    sessions.ts        ← GET  /api/sessions
    session.ts         ← GET  /api/session/:id   (history replay)
    message.ts         ← POST /api/message
    diff.ts            ← GET  /api/session/:id/diff
    todo.ts            ← GET  /api/session/:id/todo
    context.ts         ← GET  /api/session/:id/context
    abort.ts           ← POST /api/abort
    approval.ts        ← POST /api/approval
```

### 4.2 Startup

```typescript
const transports: Transport[] = []
if (env.TELEGRAM_BOT_TOKEN) transports.push(createTelegramTransport({...}))
if (env.WEB_ENABLED === 'true') transports.push(createWebTransport({...}))
for (const t of transports) await t.start({ cardBus, state })
```

Web transport binds `WEB_HOST:WEB_PORT` (default `127.0.0.1:7081`). Static
files served from `web/dist/`. Bot fails fast at startup if
`WEB_ENABLED=true` and `web/dist/` is missing.

### 4.3 WebSocket protocol

URL: `wss://<host>/ws` — protected by `cf-access.ts`.

Server → Client:
```typescript
type ServerMsg =
  | { type: 'hello';        sessions: SessionSummary[]; activeSessionId?: string }
  | { type: 'card';         card: StructuredCard }
  | { type: 'session.list'; sessions: SessionSummary[] }
  | { type: 'approval';     card: StructuredCard }
  | { type: 'error';        message: string }
  | { type: 'pong' }
```

Client → Server:
```typescript
type ClientMsg =
  | { type: 'subscribe'; sessionId: string; lastSeenAt?: number }
  | { type: 'ping' }
```

`SessionSummary`:
```typescript
interface SessionSummary {
  id: string
  title?: string
  agent?: string
  model?: string
  cost?: number
  lastActiveAt: number
  unread: boolean
}
```

### 4.4 REST endpoints

| Endpoint | Use | Response |
|---|---|---|
| `GET /api/me` | Validate CF JWT, return user email | `{ email }` |
| `GET /api/sessions` | Bot-touched sessions (from `state.json` `sessionCosts`) | `SessionSummary[]` |
| `GET /api/session/:id` | History replay via `reconstructHistory` (Section 8.6) | `StructuredCard[]` |
| `POST /api/message` | Submit a prompt | `{ messageId }` |
| `GET /api/session/:id/diff` | Pass-through to opencode `/session/:id/diff` | `Diff[]` |
| `GET /api/session/:id/todo` | Pass-through to opencode `/session/:id/todo` | `Todo[]` |
| `GET /api/session/:id/context` | Compose agent/model/tokens/cost | `Context` object |
| `POST /api/abort` | Abort current generation | `{ ok: true }` |
| `POST /api/approval` | `{ requestId, decision: 'once'\|'always'\|'reject' }` | `{ ok: true }` |

### 4.5 History replay path

`reconstructHistory(client, sessionId)` (Section 8.6) calls
`client.session.messages` and converts each opencode message into
`StructuredCard[]`. Web reuses this for `GET /api/session/:id`. Telegram
never replays history (users see it in Telegram chat already).

### 4.6 Heartbeat & reconnect

- Client sends `{type:'ping'}` every 25s; server replies `{type:'pong'}`.
- After 45s without pong, client tears WS down and reconnects with
  exponential backoff (2s/4s/8s/16s/cap 30s).
- On reconnect, client subscribes with `lastSeenAt` (max timestamp it has);
  server replays missed `StructuredCard`s from its in-memory ring buffer
  (`WEB_SESSION_CACHE_SIZE`, default 100/session).

---

## Section 5 — Web Frontend (SvelteKit shared codebase)

### 5.1 Layout

```
web/
  package.json
  svelte.config.js
  vite.config.ts
  src/
    app.html
    routes/
      +layout.svelte             ← header + sidebar + main 3-pane
      +page.svelte               ← redirect to lastActiveSession or first
      [sessionId]/+page.svelte
    lib/
      ws/
        client.ts                ← createWsClient(): { send, on, close }
        store.ts
      api/
        client.ts                ← fetch wrapper w/ credentials
        sessions.ts, message.ts, approval.ts
      stores/
        sessions.ts              ← Record<sessionId, StructuredCard[]>
        activeSession.ts         ← cookie-persisted active session id
        connection.ts            ← 'connected'|'reconnecting'|'offline'
      components/
        SessionList.svelte, SessionItem.svelte
        Composer.svelte                     ← input + agent/model selector + send
        CardUser.svelte, CardThinking.svelte, CardStreaming.svelte
        CardAssistant.svelte, CardError.svelte, CardStatus.svelte
        CardInfo.svelte
        ToolCallList.svelte                 ← collapse / expand
        MarkdownView.svelte                 ← marked + DOMPurify
        ApprovalModal.svelte
        ConnectionBadge.svelte
      adapters/
        pwa.ts                              ← service worker + manifest
        extension.ts                        ← chrome.storage URL resolution
  static/
    manifest.webmanifest
    icon-192.png, icon-512.png
    service-worker.js                       ← offline fallback page only
  extension/
    manifest.json, background.ts, sidepanel.html, sidepanel-entry.ts
    icons/16.png, 32.png, 128.png
  build-extension.ts                        ← packaging script
  tests/
    e2e/happy-path.spec.ts
```

### 5.2 Desktop layout

```
┌─────────────────────────────────────────────────────────┐
│  oprc          🟢 build · k2p6      $0.024     ⚙  user@ │
├──────────┬──────────────────────────────────────────────┤
│ Sessions │                                              │
│          │                                              │
│ ▸ build  │           (cards stream here)                │
│   2m     │                                              │
│ ▸ plan   │                                              │
│   1h     │                                              │
│          │                                              │
├──────────┼──────────────────────────────────────────────┤
│  + new   │  [ message...           ] [agent▾] [model▾] ➤│
│ session* │                                              │
└──────────┴──────────────────────────────────────────────┘

* greyed — read-only session list per Section design decision (B)
```

Mobile: sidebar collapses to a drawer, header shows the active session
name and tap toggles the drawer.

### 5.3 Streaming render

`kind: 'streaming'` arrival → `sessions[sessionId]` last card replaced
with merged `markdownSrc` and `tools[]`. `marked` + `DOMPurify` re-renders
each push. On `kind: 'assistant'`, the streaming card is replaced with a
finalized one carrying `AssistantMeta`.

### 5.4 Agent / model selectors (cross-transport)

Composer drop-downs read/write `state.nextAgent` and `state.nextModel`
(the same shared state Telegram already uses). The next prompt submission
from either Web or Telegram consumes those overrides (existing relay
logic). Persisted in `state.json`.

### 5.5 Approval modal

`kind: 'approval'` → blocking modal. Three buttons map to
`POST /api/approval` body `{ decision: 'once' | 'always' | 'reject' }`.
Modal cannot be dismissed without making a decision (mirrors TUI).

### 5.6 PWA manifest

```json
{
  "name": "opencode-remote-control",
  "short_name": "oprc",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Service worker only registers an offline fallback page; no API response
caching (real-time priority).

### 5.7 Theming

Single dark theme. CSS variables defined; no light-theme UI in v0.5.0.

---

## Section 6 — Chrome Extension

### 6.1 Manifest V3

```json
{
  "manifest_version": 3,
  "name": "opencode-remote-control",
  "version": "0.5.0",
  "permissions": ["sidePanel", "contextMenus", "storage", "activeTab"],
  "host_permissions": ["https://*/"],
  "background": { "service_worker": "background.js" },
  "side_panel": { "default_path": "sidepanel.html" },
  "action": { "default_title": "Open oprc" },
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "128": "icons/128.png" }
}
```

### 6.2 First-run config

Toolbar action opens a one-time popup:

```
Bot URL:  [ https://oprc.example.com   ]
[ Connect ]
```

URL stored in `chrome.storage.local`. Authentication = CF Access cookie
(already set when user first hits the URL through a regular tab). The
extension does no authentication of its own.

### 6.3 Side panel = shared SvelteKit app

Same components as PWA. `adapters/extension.ts`:

```typescript
export async function getBotUrl(): Promise<string> {
  const { botUrl } = await chrome.storage.local.get('botUrl')
  if (!botUrl) throw new Error('Bot URL not configured')
  return botUrl
}
```

WS URL becomes `wss://<botUrl>/ws`.

### 6.4 Context menu

`background.ts`:

```typescript
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'oprc-send-selection',
    title: 'Send to opencode',
    contexts: ['selection', 'link'],
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'oprc-send-selection') return
  const payload = formatSelection(info, tab)
  await chrome.sidePanel.open({ tabId: tab.id })
  chrome.runtime.sendMessage({ type: 'inject-prompt', payload })
})
```

Side panel listens for `inject-prompt` and pre-fills the Composer
(**does not auto-submit**).

### 6.5 Prompt template

Selection on a page:
```
[Page] https://opencode.ai/docs/sdk/
[Selection]
const result = await client.session.prompt({ ... })
```

Link right-click:
```
[Link] https://opencode.ai/docs/sdk/
```

User adds their question manually before sending.

### 6.6 Distribution

- Chrome Web Store submission (~1 week review)
- Sideload `extension-dist.zip` as a GitHub release asset
- README documents both paths

---

## Section 7 — Cloudflare Access Auth

### 7.1 User-side configuration

In Cloudflare Zero Trust:
1. Create tunnel: `cloudflared tunnel create oprc`
2. Route `oprc.<your-domain>.com` → `http://127.0.0.1:7081`
3. Create Access Application (Self-hosted) protecting the hostname
4. Set identity providers (Google / GitHub / OTP)
5. Policy: `include: emails [your-email]`
6. Copy the application's AUD tag into `.env`:
   - `WEB_CF_ACCESS_AUD=<aud-tag>`
   - `WEB_CF_ACCESS_TEAM=<team-name>`

### 7.2 Middleware

`src/transport/web/middleware/cf-access.ts`:

```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose'

const JWKS = createRemoteJWKSet(
  new URL(`https://${env.WEB_CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`)
)

export async function cfAccessMiddleware(c: Context, next: Next) {
  if (devBypassActive(c)) {
    c.set('user', { email: env.WEB_CF_ACCESS_DEV_EMAIL, sub: 'dev' })
    return next()
  }
  const token = c.req.header('cf-access-jwt-assertion')
              ?? c.req.query('cf_access_jwt')
              ?? getCookie(c, 'CF_Authorization')
  if (!token) return c.text('Unauthorized', 401)
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${env.WEB_CF_ACCESS_TEAM}.cloudflareaccess.com`,
      audience: env.WEB_CF_ACCESS_AUD,
    })
    c.set('user', { email: payload.email as string, sub: payload.sub })
    await next()
  } catch {
    return c.text('Invalid token', 401)
  }
}
```

### 7.3 WebSocket auth

WS handshake cannot carry custom headers from the browser. CF Access
injects the JWT cookie automatically when the WS is connected via the
tunnel hostname. Order of lookup: header → query → cookie.

### 7.4 Dev bypass

`WEB_CF_ACCESS_DEV_BYPASS=true` + host matching `127.0.0.1|localhost` ⇒
middleware injects a fake user and skips verification. Production
hostnames (anything else) ignore the flag, preventing misconfiguration.

Startup check: if `WEB_CF_ACCESS_AUD` is empty **and** `WEB_HOST` is not
loopback, bot refuses to start with a clear error.

---

## Section 8 — Relay Refactor

### 8.1 Layered design

```
EventStream  →  relay.ts  →  CardBus  →  per-transport renderers
```

### 8.2 `CardBus`

`src/core/card-bus.ts`:

```typescript
export interface CardBus {
  publish(card: StructuredCard): void
  subscribe(sessionId: string, fn: (card: StructuredCard) => void): () => void
  subscribeAll(fn: (card: StructuredCard) => void): () => void
  recent(sessionId: string, limit?: number): StructuredCard[]
}

export function createCardBus(): CardBus { /* EventEmitter + ring buffer */ }
```

- One bus per process, injected at `Transport.start`.
- Internal ring buffer: `Map<sessionId, StructuredCard[]>`, capped by
  `WEB_SESSION_CACHE_SIZE`.
- `publish` errors in subscribers do not propagate; logged only.

### 8.3 Relay responsibilities (revised)

`src/core/relay.ts` after refactor:
- Subscribe to opencode session SSE
- Maintain streaming state (streamedText, tools[], assistantMessageId)
- Publish to CardBus, in order:
  1. `thinking` (on incoming user message)
  2. `streaming` (each delta / tool update — throttled per Section 3.5)
  3. `assistant` (on `session.idle`, with populated meta)
- On error: publish `error`
- On approval event: publish `approval`

Relay never calls `transport.send/edit` directly.

**Preserve existing resilience during refactor** (added in v0.4.1 hotfix):
- `submitWithRetry` (5 attempts, exp backoff base 2s, abort-aware) wraps
  every `submitPrompt` call
- `delayOrAbort(ms, signal)` helper for cancellable waits
- `isNetworkError(err)` classifier (fetch failed / ECONNREFUSED / ECONNRESET
  / ENOTFOUND / network / timeout / socket hang up)

These move with the relay refactor unchanged. SSE reconnect logic in
`event-stream.ts` (3s base exp backoff, cap 30s, max 15 failures) is
likewise preserved.

### 8.4 Transport interface (revised)

`src/transport/interface.ts`:

```typescript
export interface Transport {
  readonly name: string
  readonly capabilities: ChannelCapabilities

  start(deps: { cardBus: CardBus; state: SessionState }): Promise<void>
  stop(): Promise<void>

  // Direct send (for slash-command replies that don't go through relay)
  send(chatId: string, card: StructuredCard): Promise<{ messageId: string }>

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  onCommand(name: string, handler: (msg: IncomingMessage) => Promise<void>): void
  onButtonClick(handler: (data: string, msg: IncomingMessage) => Promise<void>): void
}

export interface ChannelCapabilities {
  readonly edit: boolean
  readonly maxMessageLength: number
  readonly buttons: boolean
  readonly richText: boolean
  readonly streaming: boolean        // NEW: true ⇒ push every delta; false ⇒ throttle+paginate
}
```

`edit`, `delete` removed from interface. Message editing is a Telegram
renderer internal concern.

### 8.5 Telegram session renderer

`src/transport/telegram/renderer.ts` — one instance per (chatId × sessionId):

```typescript
class TelegramSessionRenderer {
  private activeMessageId?: string
  private chunkIndex = 0
  private chunkMd = ''
  private chunkTools: ToolCall[] = []

  onCard(card: StructuredCard) {
    switch (card.kind) {
      case 'thinking':  return this.startThinking(card)
      case 'streaming': return this.appendOrPaginate(card)
      case 'assistant': return this.finalize(card)
      case 'error':     return this.markError(card.message)
      case 'approval':  return this.sendApprovalMessage(card)
      case 'status':
      case 'info':      return this.sendInfoMessage(card)
      case 'user':      return     // Telegram already shows user's own message
    }
  }
  // ...pagination, collapse logic per Section 3
}
```

`TelegramTransport.start` calls `cardBus.subscribeAll(fn)` once and
dispatches each card to the appropriate per-session renderer.

### 8.6 History reconstruction

`src/core/history.ts`:

```typescript
export async function reconstructHistory(
  client: OpencodeClient,
  sessionId: string,
): Promise<StructuredCard[]> {
  const { data } = await client.session.messages({ path: { id: sessionId } })
  const cards: StructuredCard[] = []
  for (const m of data ?? []) cards.push(...messageToCards(m))
  return cards
}
```

`messageToCards` converts:
- User messages → `kind: 'user'`
- Assistant messages → one `kind: 'assistant'` per message (multi-part
  Telegram pagination is **renderer-only**, never enters StructuredCard)
- Approval requests → `kind: 'approval'` if still pending

### 8.7 Backwards compatibility

- `Card` (the current Telegram-flavored type) renamed to `TelegramCard` and
  kept inside `src/transport/telegram/`. All public uses elsewhere migrate
  to `StructuredCard`.
- `rawHtml` field stays on `TelegramCard` (used by slash-command handlers
  that write HTML directly).
- All tests touching `Card` updated.

---

## Section 9 — Error Handling

### 9.1 Layer table

| Layer | Source | Handling |
|---|---|---|
| opencode SDK | 5xx / fetch failed / abort | `submitWithRetry` — 5 attempts, exp backoff base 2s (cap ~32s/iter, ~62s window), abort-aware via `delayOrAbort` |
| EventStream SSE | Connection drop | Exp backoff reconnect — 3s base, cap 30s, max 15 failures before giving up |
| CardBus | Subscriber throws | Logged, isolated |
| TelegramRenderer | Telegram API errors | See 9.2 |
| WebSocket | Client disconnect / send fail | Mark dead, next ping reconnects |
| CF Access JWT | Expired/invalid | 401 → frontend redirects to CF login |

### 9.2 Telegram render errors

- `MESSAGE_TOO_LONG`: hard pagination fallback (should be impossible after Section 3)
- `message is not modified`: ignored (existing)
- `429`: parse retry-after, pause all edits; CardBus buffers safely
- Network: one retry, then publish `kind: 'error'` so user sees the failure

### 9.3 Web error UX

- WS down: badge `🟡 reconnecting`, exp-backoff reconnect
- API 5xx: toast "Server error · retry"
- Composer submit fails: retain text, button → red "Retry"
- Approval timeout: no countdown — wait until opencode rescinds

---

## Section 10 — Testing

### 10.0 Preserve existing tests during refactor

After Phase 4 + v0.4.1 hotfix: 14 test files, 89 cases, all passing.
Phase 5's relay refactor (Section 8) must keep these green — especially:
- `tests/unit/relay.test.ts` retry/abort cases (4 new ones from 8570e6d)
- `tests/unit/event-stream.test.ts` SSE exp-backoff cases
- `tests/unit/approval.test.ts` v1/v2 event compatibility

Where the refactor changes the relay signature (now publishing to CardBus
instead of editing transport directly), update the test setup to subscribe
to a fake CardBus; the assertions about retry/abort behavior stay
identical.

### 10.1 New unit tests

```
tests/unit/
  card-bus.test.ts
  history.test.ts
  telegram/
    renderer.test.ts
    overflow.test.ts                   ← Section 3 cases
  web/
    cf-access.test.ts
    routes.test.ts
    ws-hub.test.ts
    card-emitter.test.ts
```

Required overflow cases:
- 3000-char answer + 50 tools → single message
- 5500-char answer + 10 tools → 2 parts, footer on Part 2
- 15000-char answer + 20 tools → 4 parts, headers correct
- Code block crossing chunk boundary → strong split + `(continuing code block)` marker
- 200 tools → collapse to first-2 + last-5 + `… 193 more`
- Stop button moves with active chunk on pagination

### 10.2 Integration tests

```
tests/integration/
  e2e-telegram-overflow.test.ts
  e2e-web-roundtrip.test.ts
  e2e-dual-transport.test.ts
```

### 10.3 Svelte unit tests

```
web/src/lib/components/
  Composer.test.ts
  CardStreaming.test.ts
  ToolCallList.test.ts
  ApprovalModal.test.ts
```

Tooling: Vitest + `@testing-library/svelte`.

### 10.4 Playwright E2E

`web/tests/e2e/happy-path.spec.ts` — one path:
- launch bot with mock opencode + headless Chrome
- dev-bypass login
- select session → send prompt → observe streaming → final
- open `/context` panel, verify data

No PWA install or extension tests in v0.5.0.

---

## Section 11 — Files & Environment

### 11.1 New / modified files (overview)

```
NEW
  src/core/structured-card.ts
  src/core/card-bus.ts
  src/core/history.ts
  src/transport/telegram/renderer.ts
  src/transport/web/                              (all)
  web/                                            (all)
  tests/unit/card-bus.test.ts
  tests/unit/history.test.ts
  tests/unit/telegram/renderer.test.ts
  tests/unit/telegram/overflow.test.ts
  tests/unit/web/*.test.ts
  tests/integration/e2e-*.test.ts

MODIFIED
  src/core/relay.ts              (major refactor)
  src/transport/interface.ts     (revised contract)
  src/transport/telegram/render.ts
  src/transport/telegram/handlers.ts
  src/transport/telegram/handlers/info-commands.ts
  src/index.ts                   (start multiple transports)
  src/config.ts                  (new env vars)
  .env.example                   (new vars)
  README.md                      (Web + CF Tunnel sections)
  CHANGELOG.md                   (v0.5.0 entry)
  package.json                   (deps + scripts)
  .github/workflows/ci.yml       (web build + tests)
```

### 11.2 New dependencies

| Package | Purpose | Location |
|---|---|---|
| `hono` | HTTP server | root |
| `jose` | JWT verify (CF Access) | root |
| `ws` | WebSocket server | root |
| `svelte`, `@sveltejs/kit`, `vite`, `@sveltejs/adapter-static` | Web framework | `web/` |
| `marked`, `dompurify`, `@types/dompurify` | Markdown rendering | `web/` |
| `@testing-library/svelte`, `@playwright/test` | Frontend testing | `web/` |
| `concurrently` | Dev script | root |

### 11.3 New env vars

```bash
# Web transport (all default = disabled)
WEB_ENABLED=false
WEB_HOST=127.0.0.1
WEB_PORT=7081
WEB_SESSION_CACHE_SIZE=100

# Cloudflare Access
WEB_CF_ACCESS_AUD=
WEB_CF_ACCESS_TEAM=
WEB_CF_ACCESS_DEV_BYPASS=false
WEB_CF_ACCESS_DEV_EMAIL=dev@localhost

# Telegram pagination tuning (optional)
TG_CHUNK_SOFT_LIMIT=3500
TG_CHUNK_HARD_LIMIT=3900
```

---

## Section 12 — Build / Deploy / CI

### 12.1 Top-level scripts

```json
{
  "build":      "tsc && cd web && npm run build && npm run build:extension",
  "dev":        "concurrently 'tsx watch src/index.ts' 'cd web && npm run dev'",
  "start":      "node dist/cli/index.js",
  "test":       "vitest run && cd web && npm run test",
  "test:e2e":   "cd web && npx playwright test"
}
```

Bot startup checks `web/dist/` exists when `WEB_ENABLED=true`; otherwise
prints `Run "npm run build" first` and exits.

### 12.2 CI updates

`.github/workflows/ci.yml`:

```yaml
- run: cd web && npm ci
- run: cd web && npm run build
- run: cd web && npm run test
- run: cd web && npx playwright install --with-deps chromium
- run: npx vitest run
- run: cd web && npx playwright test
```

### 12.3 Release artifacts

`git tag v0.5.0` triggers a release workflow that publishes:
- `oprc-v0.5.0.tgz` — npm pack of root
- `oprc-extension-v0.5.0.zip` — extension-dist
- README and CHANGELOG attached

Chrome Web Store submission is manual (filing date logged in CHANGELOG).

### 12.4 Roadmap update

After release, update `2026-05-15-opensource-roadmap.md`:
- M2 (OSS prep) → done (closed in Phase 4.5)
- M4 (Web) → done at v0.5.0
- Note CF Access decision (replaces 6-digit pairing in the outline)

---

## Phase 4.5 — OSS Prep Wrap-up (precedes Phase 5)

Already largely complete. Remaining items:

- [ ] `CONTRIBUTING.md` (dev setup, test/build commands, PR conventions)
- [ ] `.github/dependabot.yml`
- [ ] `git tag v0.4.0-rc.1`

Estimated effort: 1–2 hours. Treated as a Phase 5 prerequisite, not a
separate sprint.

---

## Success Criteria

1. `WEB_ENABLED=false` default — existing Telegram users see no behavior
   change other than improved Telegram streaming (Section 3).
2. Long-thinking Telegram runs now produce multi-part messages with the
   final answer always visible at the bottom.
3. PWA installs to phone home screen, connects to bot via CF tunnel +
   Access, shows the same session as Telegram in real time.
4. Chrome Extension side panel loads same UI, context menu sends page
   selection into the Composer pre-fill.
5. CF Access tokens validated correctly; dev bypass works only on loopback.
6. `npm test` + `npm run test:e2e` all green in CI.
7. Bidirectional sync verified manually: send from Telegram → see in Web;
   send from Web → see in Telegram.
