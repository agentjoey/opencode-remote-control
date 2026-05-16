# Phase 4 Design Spec — Productization & TUI Parity

> **Revised 2026-05-16** after research into the opencode SDK + ecosystem.
> See `2026-05-16-architecture-comparison.md` for the Plan A vs Plan B
> decision and the differentiation positioning rationale.

## Goal

Close the three user-facing gaps from Phase 1/2 while staying SDK-native and
in our differentiation lane (SDK-native reference impl + Telegram+Web from
one codebase; not chasing grinev feature-by-feature).

1. **Productize the startup** — one command starts the bot; spawning opencode
   serve when missing is opt-in. OSS users don't need three terminal windows.
2. **Information parity with TUI** — `/diff`, `/todo`, `/context`, inline
   tool-call rendering, selective push. Coding context visible from Telegram.
3. **TUI ↔ Bot two-way state sync** — agent/model/session state observed
   bidirectionally so /status and pinning reflect real-world state.

Sprint duration: **~2 weeks**. Exit: `git tag v0.4.0-rc.1`.

**Depends on Phase 3** (transport abstraction + `session.prompt()` migration
landed). Do not start Phase 4 until Phase 3 ships.

## Positioning vs grinev (642★) and OpenChamber (4.3k★)

We **don't** try to match grinev on Telegram feature breadth (voice, scheduled
tasks, 6 locales, file attachments). We **don't** try to match OpenChamber on
multi-surface coverage (web/desktop/VS Code/terminal).

What we *do* deliver in Phase 4:
- Productized install (table stakes — everyone has this; we match the bar)
- SDK-native architecture you can read and extend (our lane)
- Information cards and TUI sync that the next consumer (Phase 5 Web) reuses
  directly (architectural payoff)

Out of scope for Phase 4:
- Voice input
- Scheduled / recurring tasks
- File attachments in cards
- Multi-language UI strings
- Discord/Feishu/Slack transports

---

## Pain points recap (from user)

### Pain 1 — Startup complexity

Today: 3 terminals (opencode serve, opencode TUI, our bot) or carefully-tuned
launchd plist. Step 1 alone disqualifies most OSS users.

### Pain 2 — TUI/Bot information asymmetry

TUI shows: tool calls inline, todos, diff view, full message tree, token
usage, cost, reasoning, sub-agent task tree. Bot today shows only streamed
text and after-the-fact `/files`. Away from desk, you can't really follow
what the agent is doing.

### Pain 3 — Bot commands diverge from TUI

Phase 3 fixes this for `/agent` and `/model` (per-message override via
`session.prompt()`). Phase 4 closes the remaining gap: `/session pin`
syncs both ways; `/status` reflects what TUI currently shows.

---

## Track A — Single-command launcher

### Behavior

```
npm start                                  # foreground, dev-friendly
npx opencode-remote-control start          # production, from published npm
npx opencode-remote-control init           # interactive setup wizard
npx opencode-remote-control install-svc    # launchd registration
```

The launcher (`src/launcher/index.ts`):

1. Reads config via existing `loadConfig`.
2. Checks if `opencode serve` is reachable at `OPENCODE_BASE_URL`.
3. If not reachable AND `SPAWN_OPENCODE=true` (default):
   - Spawns `opencode serve --port <port>` as a child process.
   - Captures stdout/stderr to `data/logs/opencode-serve.log`.
   - Waits for `client.global.health()` to pass (with timeout).
4. Starts the bot (Phase 3's `runBot()`).
5. On `SIGTERM`/`SIGINT`: terminates bot, then *our* spawned opencode serve
   (we never kill a serve we didn't start).
6. On opencode-serve child exit: if we own it, restart with backoff (2s→4s→
   8s, capped at 30s); if we don't own it, log + wait for health to return.

### Why spawn opencode (vs. require user to start it)

grinev's `npx` install assumes user already runs `opencode serve`. We split:
- Default: spawn it. User just needs opencode installed.
- `SPAWN_OPENCODE=false`: bring-your-own-server (advanced users).

This matches OpenChamber's approach (external dependency assumption) with
grinev's npx ergonomics.

### File changes

- **New**: `src/launcher/index.ts` (~150 lines), `src/launcher/spawn.ts`
  (subprocess management)
- **Modify**: `src/index.ts` — extract `main()` body into exported `runBot()`
- **Modify**: `package.json` — `"start": "node dist/launcher.js"`,
  `"bin": { "opencode-remote-control": "dist/launcher.js" }`
- **Modify**: `deploy/ai.opencode.remote-control.telegram.plist` — point at
  `dist/launcher.js`. Remove `KeepAlive` (launcher owns recovery for opencode;
  bot crashes still keep launchd alive).
- **New**: `scripts/install-launchd.sh`, `scripts/uninstall.sh`

### Configuration (new env)

```
SPAWN_OPENCODE=true          # if false, launcher requires external serve
OPENCODE_BIN=opencode        # binary path; default looks up PATH
OPENCODE_PROJECT=<cwd>       # project directory passed to opencode serve
LOG_DIR=./data/logs          # spawned-process log location
```

### Acceptance

- Fresh checkout → `npm install && npm run build && npm start` → bot online
  within 5s of opencode serve becoming healthy
- `kill <opencode-pid>` → launcher restarts it within 10s
- `kill <launcher-pid>` → all child processes terminated (verify no orphan
  `opencode serve` via `ps`)
- `scripts/install-launchd.sh` on a clean macOS account → bot starts on
  next login

### Out of scope for Track A

- Windows / Linux installers (macOS only for v0.4; document)
- Auto-installing opencode CLI itself (we print install instructions if
  missing)
- TUI auto-spawn (interactive terminal dependency; users open manually)

---

## Track B — Information parity

### B.1 — `/diff [N]`

```
📝 Diff — ses_…123

src/handlers/chat.ts
   - throw new Error('foo')
   + throw new TuiSubmitError('bar', 'foo')

src/config.ts
   + STREAM_OUTPUT: z.string()...

2 files · 5 lines
```

API: `GET /session/{id}/diff` (per opencode OpenAPI doc).

Implementation:
- New command in `transport/telegram/handlers.ts` (and in `core/` so Web
  reuses).
- Truncate per-file at 10 lines with `…and N more lines` footer.
- Cap total at 4000 chars.
- Fallback: "No diffs yet" card if empty.
- Optional `/diff <N>` to show last N diffs.

### B.2 — `/todo`

```
✅ Todos — ses_…123

✓  Add streaming output
▢  Wire EventStream reconnect handling
▢  Update OPS.md
```

API: `GET /session/{id}/todo`.

### B.3 — `/context`

```
📊 Context — ses_…123

Agent:    build
Model:    kimi-for-coding/k2p6
Tokens:   42,100 in · 8,700 out · 1,300 cache
Cost:     $0.34
Files:    7 in context  · /files for list
```

Sources: `client.session.get({ path: { id } })` (cost/tokens/agent),
`client.config.get()` (model per agent), existing `/files` derivation for
file count.

### B.4 — Inline tool-call rendering

When `core/relay.ts` sees a `message.part.updated` with `part.type === 'tool'`,
append a one-line summary into the streamed message:

```
Let me check the structure.

▸ bash · ls -la
▸ read · src/handlers/chat.ts

The file uses createReplyStream throttled to 1s edits.

▸ edit · src/handlers/chat.ts

Done.
```

Each tool call summarized to: `▸ <toolName> · <short args>`.

Args picked per tool:
- `bash` → command string
- `read` / `edit` / `write` → file path
- `grep` / `find` → query
- others → truncated JSON

Tool output **not** inlined (Telegram char limits + signal-to-noise). User
can run `/files` or `/diff` for results.

Feature flag: `TOOL_CALLS_INLINE=true` (default). Set false to revert.

### B.5 — Selective push notifications

Today's bot pushes only approval cards. Phase 4 adds:

- **Long task completed**: when a session that was busy >60s goes idle,
  send `✅ Session ses_…123 finished` — but only if user engaged this
  session in the last hour (prevents random pings from background work).
- **Test failed**: if a tool result's last 200 chars match
  `\b(FAIL|error:|✗|FAILED)\b` (heuristic). Opt-out via
  `PUSH_TEST_FAILURES=false`.

Hard cap: 10 push notifications per hour. Cooldown: 5 minutes per session.

### File changes for Track B

- `src/transport/telegram/handlers.ts` — three new commands
- `src/core/relay.ts` — tool-part observation + inline summary lines
- `src/transport/telegram/render.ts` — tool-summary line formatter
- `src/core/push.ts` — selective push module (subscribes to SSE)
- `tests/unit/relay-tools.test.ts`, `tests/unit/push.test.ts`

### Acceptance

- `/diff`, `/todo`, `/context` all render their cards
- Coding task: streamed text contains `▸ tool · args` lines interleaved
- After a long task: "✅ finished" card arrives (engaged-recently heuristic)
- Test-failed push fires when bash output matches the regex; respects
  hour-cap and per-session cooldown

---

## Track C — Two-way state sync

### C.1 — Subscribe to TUI-state events

`event-stream.ts` already sees every SSE event via `onAny`. Extend
`core/state.ts` to track:

- TUI's currently-selected session id (some event carries this; verify
  empirically before coding)
- Current agent for the TUI's active session (from `session.agent` field on
  newly seen events; refreshed on `session.updated` or after `agent.cycle`)

```typescript
interface SessionState {
  // existing
  getLastSessionId(): string | undefined
  setLastSessionId(id: string | undefined): void
  // new
  getTuiSelectedSession(): string | undefined
  getCurrentAgent(): string | undefined
}
```

### C.2 — Bot-initiated changes propagate to TUI

When the bot does:
- `/session pin <id>` → call `POST /tui/select-session { sessionID: id }`
  to navigate the TUI.
- `/abort` → already does TUI-visible abort via `client.session.abort()`.
- `/agent` / `/model` (Phase 3) — these are *per-message overrides on our
  side*; don't propagate to TUI. The TUI continues to show whatever agent
  the session is pinned to. This is intentional: bot-side agent override
  is *additional state*, not a change to opencode state.

### C.3 — `/status` reflects observed TUI state

```
🟢 opencode healthy
📊 6 sessions · 1 busy
📌 ses_…123 (build · k2p6) ← from TUI's current selection
🤖 Next-agent override: chat (set via /agent)
```

Replaces today's bot-only view of "current session".

### File changes for Track C

- `src/core/state.ts` — add TUI-observed fields
- `src/core/relay.ts` (or new `src/core/tui-sync.ts`) — subscribe relevant
  events, update state
- `src/transport/telegram/handlers.ts` — `/status` uses observed state;
  `/session pin` calls `/tui/select-session`

### Acceptance

- Switch sessions in TUI; bot's `/status` reflects within 2s
- `/session pin <id>` in bot → TUI navigates to that session
- `/agent build` in bot → next message uses build agent (Phase 3 covers
  this); `/status` shows "Next-agent override: build"
- TUI runs `agent.cycle` → bot's `/status` updates within 2s

---

## Implementation order (within Phase 4)

Recommended sequence: A → C → B.

| # | Track | Task | Est |
|---|---|---|---|
| 1 | A | spawn.ts (subprocess helper with backoff) | 0.5d |
| 2 | A | launcher/index.ts + extract runBot from index.ts | 0.5d |
| 3 | A | Plist + install-launchd.sh + uninstall.sh + docs | 0.5d |
| 4 | A | Live test: kill serve, launcher recovers; uninstall clean | 0.5d |
| 5 | C | Probe SSE for TUI-state events (curl -N + document findings) | 0.5d |
| 6 | C | Extend SessionState; wire EventStream observation | 1d |
| 7 | C | Update /status, /session pin to use observed state | 0.5d |
| 8 | B | /diff, /todo, /context commands + tests | 1.5d |
| 9 | B | Inline tool-call rendering in relay + tests | 1.5d |
| 10 | B | push.ts + finished-session + test-failed heuristics | 1d |
| 11 | All | Smoke test full workflow end to end | 1d |
| 12 | All | CHANGELOG; tag v0.4.0-rc.1 | 0.5d |

Total: ~10 working days.

---

## Definition of done

- [ ] `npm start` brings up bot + spawned opencode serve with zero extra terminals
- [ ] `scripts/install-launchd.sh` on a clean macOS account → bot online
- [ ] Kill `opencode serve` → launcher restarts within 10s
- [ ] `/diff`, `/todo`, `/context` render their cards
- [ ] Coding task shows inline `▸ tool · args` lines
- [ ] Push notification arrives after long task completion (engaged-recently)
- [ ] `/status` reflects TUI's current selected session + agent
- [ ] Switching session in TUI → bot reflects within 2s
- [ ] All existing tests still pass + new tests for launcher spawn, relay tools, push, state sync
- [ ] `npm test` ≥ 60 tests; `npx tsc --noEmit` clean
- [ ] CHANGELOG.md updated with v0.4.0 entry
- [ ] `git tag v0.4.0-rc.1` ready for review

---

## Risks

| Risk | Mitigation |
|---|---|
| Subprocess management leaks orphans on crash | Trap SIGTERM/SIGINT/SIGHUP, kill children with 2s timeout fallback. Acceptance: `kill -9 launcher` → no orphan `opencode serve` |
| TUI-state SSE events may not carry what we need | Track C step 1 is a probe step. Fall back to polling `client.session.get({ id: tuiSession })` every 5s if events insufficient |
| Tool-part rendering floods past 4096 chars | Cap at 30 tool lines per message; emit "…X more tool calls" then stop appending |
| Push notifications spam | Strict gating: engaged-recently for finished, regex + opt-out for test-failed, hour-cap, per-session cooldown |
| Launcher complicates dev iteration | Keep `npm run dev` (or `node dist/index.js`) for raw bot start; launcher is for production |
| Inline tool rendering breaks streaming UX | Feature flag `TOOL_CALLS_INLINE=true` default-on; revert if regression |

---

## Out of scope (defer to later)

- Discord/Feishu/Slack transports
- Voice input
- Scheduled/recurring tasks
- File / image attachments in cards
- Multi-language UI strings
- Windows/Linux installer scripts
- Custom themes
