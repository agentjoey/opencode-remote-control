# Current Status — opencode-remote-control

Version:        v0.5.7
Last Updated:   2026-05-21

## Recent work (v0.5.5 → v0.5.7)

### v0.5.7 — Telegram streaming removed
- `renderStreaming()`/`renderThinking()`/`retryEdit()` deleted — Telegram now
  only sends final assistant messages via `sendMessage()` (no edit-based delivery)
- Web transport keeps full streaming unchanged

### v0.5.6 — Stability fixes
- **Delta accumulation** — `message.part.delta` is incremental (not full text).
  Relay tracks `partTextAcc` Map per partId, appends deltas to baseline text
  from `part.updated`, routes full accumulated text through accumulator.
  Root cause of truncated/partial assistant responses eliminated.
- **Empty text overwrite** — accumulator skips `text=""` upserts when block
  already has non-empty text (SDK sends empty on some `part.updated` events).
- **TCP hang protection** — all `sendMessage` calls have 10s timeout via
  `withTimeout()`/`sendTimed()`. No more stuck connections.
- **429 retry_after capped** at 5s — longer cooldowns force immediate fallback.
- **Thinking card timing** — published after `sessionId = resolvedId`, fixing
  earlySessionId ≠ sessionId gap and race. Early abort controller restored.
- **push fetchSummary retry** — 3s delay + retry if first fetch returns empty
  (opencode persistence race on session idle).
- **UI cleanup** — Stop button removed, Part N headers removed, continuation ⏳.
- **sendInfo retry** — 3 attempts, 2s delay, handles ECONNRESET/ETIMEDOUT.

### Core architecture changes (v0.5.5 → v0.5.7)
- `renderer.ts`: send-only mode (no edit/streaming). `sendTimed()` wraps every
  sendMessage with 10s timeout. `onCard('streaming')` → no-op.
- `relay.ts`: thinking card published after sessionId resolved; `partTextAcc`
  delta accumulation map; early abort registered before session resolution.
- `stream-accumulator.ts`: empty-text skip guard (`text=""` → no-op).
- `push.ts`: 3s retry on empty fetchSummary.

## Test status
- **144 tests passing** (26 files)
- `npx tsc --noEmit` clean
- `npm run build` → `dist/`

## Key decisions
- Telegram no longer uses streaming — eliminates editMessageText (source of
  all TCP hang/429 bugs). Only sendMessage (new messages) with 10s timeout.
- `retryEdit()` entirely removed from Telegram renderer since no edits performed.
- `retry_after` capped at 5s — if Telegram rate-limit cooldown exceeds 5s,
  skip retry and fall back to sendMessage immediately.
- Accumulator skips empty text upserts to prevent content erasure.

## Running services
- Telegram Bot via launchd: `ai.opencode.remote-control.telegram`
- Bot log: `/tmp/opencode-remote-control-telegram.log` (stdout), `.err` (stderr)
- Web PWA: not yet deployed
- opencode serve: manually started, PID 50317, port 4096
- Bot restart: `launchctl stop/start ai.opencode.remote-control.telegram`

## Next work
- Resume MathMagics MVP Task 18 (Q05 prompt iteration) — paused
- Then Tasks 19-20 (Q18 prompt iteration, Vercel deploy)
- Verify Telegram 100% delivery after streaming removal

## Key documents
- **CHANGELOG**: `CHANGELOG.md`
- **Architecture**: `docs/ARCHITECTURE.md`
- **Operations**: `docs/OPS.md`
- **Streaming optimization spec**: `docs/superpowers/specs/2026-05-19-streaming-optimization.md`
