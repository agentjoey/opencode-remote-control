# Web + Hardening Design

> Design for the post-consolidation optimization pass (v0.6.x).
> Covers backend hardening (A1–A6) and the web/PWA redesign (B1–B6).
> B5 (extension cross-origin auth) is **TBD** — tracked here, decided later.

## Goals

- Kill the long-session render avalanche (no stable card identity today).
- Make the "REST history + live WS" streams one ordered, gap-free, resumable feed.
- Tighten interaction (optimistic send, error surfacing, live session status).
- Plug the slow memory leaks and a few correctness gaps in the backend.

---

## A. Backend hardening

| # | Item | Files | Approach |
|---|---|---|---|
| A1 | Evict per-session memory on `session.deleted` | `core/card-bus.ts`, `core/state.ts`, `plugin/entry.ts` | CardBus gains `drop(sid)`; state gains `dropSession(sid)`. entry's event hook calls them on `session.deleted`. Caps prevent unbounded growth across long uptimes. |
| A2 | Validate pinned/last session before submit | `core/relay.ts` | Before submitting, verify the target session still exists (`session.get`); on 404/missing fall back to `pickSessionFallback`. Avoids 5× retry against a deleted session. |
| A3 | Approve-callback test | `tests/unit/telegram/approval-callbacks.test.ts` | Direct test of the `approve:once/always/reject` action registered in `registerHandlers` (the coverage `approval.test.ts` used to give). |
| A4 | Type the opencode events we consume | `core/opencode-events.ts` (new) | A discriminated union for the event shapes relay/push/handlers read, plus narrow helpers (`sessionIdOf`, `partOf`). Replaces scattered `as any` at the hot spots. |
| A5 | Web typecheck in CI | `.github/workflows/ci.yml`, `web/package.json` | Add `svelte-check` step so frontend type errors fail CI, not just `build`. |
| A6 | Observability | `utils/logger.ts`, `transport/web/routes/logs.ts` (new), `plugin/entry.ts` | Logger keeps an in-memory ring buffer; `GET /api/logs` returns it (auth-gated); `rc-status` reports push counters + active sessions. |

---

## B. Web / PWA redesign

### Current data flow

```
relay.handleEvent → cardBus.publish → WsHub.subscribeAll → WS {type:'card',card}
                                                          → frontend appendCard
                                                          → cardsBySession store
                                                          → {#each} render
REST: /api/me /api/sessions /api/session/:id(history) /diff /todo /context /message /abort /approval
```

### Problems being fixed

- Cards have no stable id; `{#each … (i)}` keys by index → index shift on
  streaming replace/trim → mass re-mount, each Card re-parsing markdown.
- `appendCard` `JSON.stringify(blocks)` per delta + whole-map update.
- `MarkdownView` re-parses the full string on every streaming delta.
- WS `hello{sessions}` frame is sent by the server but ignored by the client.
- History snapshot ↔ live subscribe has a gap (cards in between can be lost/dup).
- Composer has no optimistic echo and swallows send errors.

---

### B1 — Stable card identity + normalized store

**Backend.** Every `StructuredCard` gains two fields, assigned in `cardBus.publish`:

```ts
id: string    // stable per logical card
seq: number   // monotonic per session (see B3)
```

- Streaming + final assistant for one message share `id = messageId` → the
  final assistant **upserts** the streaming card (no "trim streaming then push").
- thinking/user/info/error/status get `id = \`${kind}:${seq}\``.

`StructuredCard` type (core + web `api/types`) adds `id` and `seq`. Publishers
don't set them; `cardBus.publish` stamps them (keeps call sites unchanged).

**Frontend store** becomes normalized and O(1):

```ts
interface SessionFeed { order: string[]; byId: Record<string, StructuredCard>; lastSeq: number }
// upsertCard(card): if byId[card.id] exists → replace; else push id to order.
// dedupe by seq (ignore seq <= lastSeq); no stringify, no full-list filter.
```

**Render:** `{#each feed.order as id (id)}` → keyed by stable id; only the
changed card re-renders.

### B2 — Render pipeline

- **Memoize** `MarkdownView` output for final cards (text is immutable once
  `assistant`); cache by `id`.
- **rAF-throttle** streaming re-parse (≤ one parse per frame).
- **Harden sanitize**: a single `lib/markdown/sanitize.ts` wrapping
  marked+DOMPurify, with a hook forcing `target=_blank rel="noopener noreferrer"`
  on links and an explicit allow/forbid list. Keep the 20k raw-fallback.
- *(Deferred within B2)* offload very large parses to a Web Worker — only if
  profiling shows it's needed after memoize+throttle.

### B3 — Sequence cursor (gap-free resumable feed)

`cardBus` already keeps a per-session ring buffer. Make it seq-addressable:

- Each card carries `seq` (per session, monotonic; B1).
- `WsHub` `hello` and REST history responses include `lastSeq`.
- On (re)subscribe the client sends `{type:'subscribe', sessionId, sinceSeq}`.
- `WsHub` replays buffered cards with `seq > sinceSeq` (instead of today's
  "never replay"), then live cards flow as usual.
- Client `upsertCard` ignores `seq <= feed.lastSeq` → no dup, no gap, clean
  reconnect.

Frame formats:

```
S→C hello      { type:'hello', sessions:[…], serverTime }
S→C card       { type:'card', card }            // card.seq present
S→C replayEnd  { type:'replayEnd', sessionId, lastSeq }
C→S subscribe  { type:'subscribe', sessionId, sinceSeq? }
C→S ping / S→C pong
```

### B4 — Interaction

- **Optimistic send**: Composer makes a `clientId`, inserts a local pending
  `user` card immediately; reconciles when the server's `user` card arrives
  (match on `clientId`, which `/api/message` echoes back).
- **Error surfacing**: show send failures (400/401/network) under the composer;
  keep the typed text; disable Send when `connection !== 'connected'`.
- **Live session status**: derive busy/idle + unread + cost/agent badges in
  `SessionList` from the feed (thinking/streaming ⇒ busy; assistant/error ⇒ idle).
- **Root auto-select**: `/` redirects to the most-recently-active session.
- **Approval queue**: `ApprovalModal` handles multiple pending approvals (FIFO),
  not a single overwriting slot.
- **Mobile composer**: auto-grow textarea; Enter-to-send / Shift+Enter newline
  toggle (Ctrl/Cmd+Enter still works).

### B5 — Chrome extension cross-origin auth *(TBD — decide later)*

PWA auth is CF Access **cookies**, which an extension side-panel can't rely on
cross-origin. Two candidate paths, **not yet chosen**:

- **A. Service token (leaning this way):** store a CF Access *service token* in
  `chrome.storage`; send `CF-Access-Client-Id/Secret` on REST and
  `?cf_access_jwt=`/handshake header on WS. Decoupled from browser login.
- **B. Same-site cookie:** require the tunnel to set `SameSite=None; Secure` and
  add the extension origin to the CF Access app.

Prep that helps either way (can land before the decision): give `api/client.ts`
and `ws/client.ts` an injectable `getAuth()` hook (PWA returns nothing; the
extension fills it in once B5 is decided).

### B6 — PWA polish

- **Offline shell + install**: service worker caching the app skeleton;
  `beforeinstallprompt` install affordance.
- **Connection UX**: a reconnecting/offline banner on top of `ConnectionBadge`.
- **Web Push** *(needs VAPID config — gated)*: mirror Telegram's "Session
  finished" push to subscribed PWAs. SW `push` handler + `/api/push/subscribe` +
  VAPID keys in config. Implemented behind a config gate; no-op until keys set.

---

## Rollout order

```
A1 A2 A3 A4 A5 A6        (backend, independent, small)
   │
B1 ─┬─ B3   (shared: card id+seq, normalized store, replay-since)
    └─ B2   (render pipeline)
        └─ B4 (interaction)
            └─ B6 (PWA: offline/install/connection; Web Push gated)
B5  → TBD (extension auth; getAuth() hook prepped, mechanism later)
```

Each step keeps `tsc`, `npm test`, and `web` build/tests green and ships as its
own commit.
