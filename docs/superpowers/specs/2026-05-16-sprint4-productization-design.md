# Sprint 4 Design Spec — Productization & TUI Parity

## Goal

Close the three Phase 1&2 pain points the user identified, in a single 2-week
sprint that runs **after Phase 3** (depends on the Transport abstraction landed
there):

1. **Productize the startup** — one command starts everything; OSS users don't
   need 3 terminal windows.
2. **Parity with TUI information** — coding context (diffs, todos, tool calls,
   token usage) is visible from the bot, not just the TUI.
3. **TUI ↔ Bot two-way state sync** — when one side changes agent/model/session,
   the other side reflects it.

Sprint duration target: ~2 weeks. Exit: v0.4.0 — daily-driver quality, the
"single user uses bot away from desk" workflow feels complete.

## Why Sprint 4 and not Phase 3

Phase 3 changes the *shape* of the code (transport abstraction, OSS prep). It
does not change what the user sees or how they install the system. The three
pains here are user-facing, not architectural. Mixing them with Phase 3 would
double the sprint length, increase regression risk, and create unfocused review
cycles.

Phase 3 does make Sprint 4 *cheaper*:
- The `Card` data structure means new card types (tool call, diff, todo) are
  defined once and rendered by the Telegram transport.
- The `core/relay.ts` is a clean place to plug in tool-call observation and
  state-change subscriptions.
- `core/state.ts` provides persistence for sync state.

## Dependencies

This spec assumes Phase 3 is complete:
- `src/core/relay.ts` exists with the SSE iteration loop
- `src/core/types.ts` defines `Card`, `Button`
- `src/transport/telegram/render.ts` renders cards
- `src/core/state.ts` provides file-backed `SessionState`

If Phase 3 is not done, Sprint 4 can start but Track B (new cards) and Track C
(state mutations) need conventions to avoid creating throwaway code. Recommended:
do not start Sprint 4 until Phase 3 ships.

---

## Pain points recap

### Pain 1 — Startup complexity

Today's required steps to use the bot:

1. Terminal A: `opencode serve --port 4096`
2. Terminal B: `opencode` (TUI; navigates to project dir; consumes the prompt
   queue submitted by bot's TUI-inject path)
3. Terminal C: `npm start` (or launchd)

Failure modes:
- Port 4096 in use (orphan opencode process)
- TUI never opened → bot's TUI-inject path fails → falls back to prompt_async
  (works, but messages don't appear in TUI on Mac)
- launchd auto-restart loop when opencode is down
- User doesn't know which log file to check when bot is silent

For an OSS user, this is a non-starter. Step 1 alone disqualifies most users
from following the README.

### Pain 2 — TUI/Bot information asymmetry

TUI shows: tool calls inline with args, todos, diff view, full message tree,
model token usage, cost, reasoning steps, sub-agent task tree.

Bot shows: streamed text only, plus after-the-fact `/files`. The user, away
from their desk, cannot meaningfully follow a coding task — they see the
final summary but not the progress, the tool decisions, or the state.

### Pain 3 — Bot commands diverge from TUI

We already discovered:
- `/agent` switching pretends to work but cycles only (we honestly fixed)
- `/model` has no scripted switch (we honestly fixed: opens TUI picker)
- `/session pin` is bot-only memory, not reflected in TUI
- `/status` doesn't show what agent/model the TUI is currently using

The bot and TUI maintain partially independent state. The fix is: bot's view
of "current agent/model/session" should follow whatever the TUI says, and any
bot-initiated change should propagate to the TUI.

---

## Track A — Single-command launcher

**Goal:** `npm start` (or one shell command) starts everything the user needs.
The user opens the TUI on their Mac separately when they want to *watch*; the
TUI is no longer required for the bot to function.

### Design

A new entry point `src/launcher/index.ts` that:

1. Reads config (existing `loadConfig`)
2. Checks if `opencode serve` is reachable on `OPENCODE_BASE_URL`
3. If not reachable:
   - Spawns `opencode serve --port <port>` as a child process
   - Captures stdout/stderr to `data/logs/opencode-serve.log`
   - Waits for health check to pass (with timeout)
4. Starts the bot (current `src/index.ts` main flow)
5. On `SIGTERM`/`SIGINT`: terminates the bot, then the spawned opencode serve
   (only the one *we* spawned — leave user's existing serve alone)
6. On `opencode serve` child exit: if we own it, restart with backoff;
   if we don't own it, log a warning and wait for health to come back

The TUI is **never spawned by the launcher** — it requires an interactive
terminal, which we can't provide cleanly. Users who want TUI visibility
open it manually in any terminal pointed at the same opencode server.

### File changes

- New: `src/launcher/index.ts` (~100 lines)
- New: `src/launcher/spawn.ts` — subprocess management helper
- Modify: `src/index.ts` — extract `main()` body into an exported `runBot()`
  function that the launcher calls after serve is healthy
- Modify: `package.json` — `"start": "node dist/launcher.js"`
- Modify: `deploy/ai.opencode.remote-control.telegram.plist` — point at
  `launcher.js`, not `index.js`. Remove `KeepAlive` since launcher does its own
  recovery for opencode; bot crashes still keep launchd alive.

### Configuration

New env vars (added to `src/config.ts`):

```
SPAWN_OPENCODE=true          # if false, launcher requires external serve
OPENCODE_BIN=opencode        # path to opencode binary
OPENCODE_PROJECT=<cwd>       # project directory for opencode serve
LOG_DIR=./data/logs          # where to write spawned-process logs
```

Defaults are user-friendly: spawn=true, look up `opencode` on PATH, project=cwd.

### Install ergonomics

A `scripts/install-launchd.sh` that:
- Verifies node, opencode are installed
- Builds `npm run build`
- Copies plist to `~/Library/LaunchAgents/`, substituting the absolute project
  path
- Loads with `launchctl bootstrap`
- Prints next steps (set env vars, check logs)

Provide a matching `scripts/uninstall.sh` for clean removal.

### Acceptance

- Fresh checkout → `npm install && npm run build && npm start` → bot online
  within 5s of opencode serve becoming healthy (or immediately if already up)
- Kill `opencode serve` PID → launcher restarts it within 10s
- Kill the launcher → all child processes terminated cleanly (verify with
  `ps -ef | grep opencode` shows nothing dangling)
- `scripts/install-launchd.sh` on a new Mac → bot starts on next login

### Out of scope for Track A

- Windows/Linux installers (macOS only for v0.4; document as known limitation)
- Spawning the TUI (interactive terminal dependency)
- Auto-installing opencode if missing (print install instructions instead)

---

## Track B — Information parity

**Goal:** A user reading only Telegram can follow what the agent is doing
in detail, not just the final answer.

### B.1 — `/diff` command

Show the most recent file diff for the current session.

```
📝 Diff — ses_…123

src/handlers/chat.ts
   - throw new Error('foo')
   + throw new TuiSubmitError('bar', 'foo')

src/config.ts
   + STREAM_OUTPUT: z.string()...
```

API: `GET /session/{id}/diff` (already exists in opencode OpenAPI).

Implementation:
- New command in `transport/telegram/handlers.ts`
- Reads `/session/{id}/diff`, formats as code block, truncates per file at
  10 lines with `…and N more lines` footer, caps total at 4000 chars
- Falls back to "No diffs yet" card if response is empty

Optional arg `/diff <N>` to show last N diffs.

### B.2 — `/todo` command

Show current todo list for the session.

```
✅ Todos — ses_…123

✓  Add streaming output
▢  Wire EventStream reconnect handling
▢  Update OPS.md
```

API: `GET /session/{id}/todo`.

### B.3 — `/context` command

Show session vitals.

```
📊 Context — ses_…123

Agent:    build
Model:    kimi-for-coding/k2p6
Tokens:   42,100 in · 8,700 out · 1,300 cache
Cost:     $0.34
Files:    7 in context  · /files for list
```

Sources: `GET /session/{id}` (cost, tokens, agent), `GET /config` (model per
agent), existing `/files` derivation for file count.

### B.4 — Inline tool-call rendering

The biggest behavior change. Currently the stream renders only text parts.
For a coding workflow, the user wants to see "build agent ran `bash: ls`"
inline.

Design: when `core/relay.ts` sees a `message.part.updated` with
`part.type === 'tool'`, append a one-line summary into the streamed message:

```
Let me check the structure.

▸ bash · ls -la
▸ read · src/handlers/chat.ts

The file uses createReplyStream which is throttled to 1s edits.

▸ edit · src/handlers/chat.ts

Done.
```

Each tool call summarized to a single line: `▸ <toolName> · <short args>`.
Args: bash command, file path, search query, etc. — picked per tool. Output is
**not** inlined (Telegram message limits + signal-to-noise). User can run
`/files` or `/diff` for results.

This requires adding tool-part tracking to the relay's existing text-part
tracking. The Card model already supports multi-line; no Card type changes.

### B.5 — Push notifications (selective)

Today's bot only pushes Approval cards proactively. Sprint 4 adds:

- **Long task completed** — when a session that's been busy >60s goes idle,
  send a card: `✅ Session ses_…123 finished` (only if user already engaged
  this session in the last hour; prevents random pings)
- **Test failed** — if a tool result contains `FAIL` or `error:` in the last
  100 chars of bash/run output. (Heuristic — keep simple; user can opt out
  via `PUSH_TEST_FAILURES=false`)

Out of scope:
- Push on every diff
- Push on every git commit (let user opt-in via `/notify` command in the future)
- Cross-session pushes

### File changes for Track B

- `src/transport/telegram/handlers.ts` — three new commands
- `src/core/relay.ts` — tool-part observation, inline summary lines
- `src/transport/telegram/render.ts` — tool-summary line formatter
- `src/core/push.ts` — new module for selective push (subscribes to SSE)
- `tests/unit/relay-tools.test.ts` — tool-part emission tests

### Acceptance

- `/diff` returns a card matching the design above
- `/todo` returns a card matching the design above
- `/context` returns a card matching the design above
- Running a coding task: streamed text contains `▸ tool · args` lines
  interleaved with text
- After a long task: a "✅ finished" card arrives shortly after the session
  goes idle (only when engaged-recently heuristic matches)

---

## Track C — Two-way state sync

**Goal:** the bot and TUI agree at all times on which session, agent, model
are active. State changes flow both ways.

### C.1 — Subscribe to TUI state events

`EventStream.onAny` already sees every SSE event. Extend it to extract:
- Current selected session in TUI (some event likely carries this — verify
  empirically with `curl -N http://localhost:4096/event` while clicking around
  in TUI)
- Current agent for the active session (from `session.agent` field; refreshed
  on session.updated or agent.cycle event)

Store the observed TUI state in `core/state.ts`:

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

The bot's "what session am I sending to" prefers the TUI's selected session
over its own pin. Pinning is now overridden by what TUI shows.

### C.2 — Bot-initiated changes propagate to TUI

When the bot does any of:
- `/session pin <id>` → also call `POST /tui/select-session { sessionID }`
- `/abort` → already does TUI-visible abort via `/session/{id}/abort`
- `/agent` cycle button → already routes through `/tui/execute-command`

Audit the rest. The list above is what needs to call TUI APIs after Sprint 4.

### C.3 — `/status` reflects observed TUI state

Replace bot's bot-local view of "current session" with the TUI-observed view:

```
🟢 opencode healthy
📊 6 sessions · 0 busy
📌 ses_…123 (build · k2p6)   ← from TUI, not bot's pin
```

### File changes for Track C

- `src/core/state.ts` — add TUI-observed fields
- `src/core/relay.ts` — subscribe relevant events, update state
- `src/transport/telegram/handlers.ts` — `/status` uses observed state;
  `/session pin` calls `select-session`

### Acceptance

- Click around in TUI to select different sessions; `/status` reflects the
  current selection within 2s
- `/session pin <id>` in bot → TUI navigates to that session
- `/agent` cycle button in bot → TUI agent advances → bot's `/status` shows
  the new agent name

---

## Implementation order (within Sprint 4)

Recommended sequence: A → C → B. A unblocks productization; C is a small
foundation Track B can build on (Track B's `/status` reuses observed state).

| Order | Track | Task | Estimate |
|-------|-------|------|----------|
| 1 | A | Spawn helper + launcher.ts | 0.5 day |
| 2 | A | Modify src/index.ts to export runBot, wire launcher | 0.5 day |
| 3 | A | Plist + install-launchd.sh + uninstall.sh + docs | 0.5 day |
| 4 | A | Live test: kill serve, launcher recovers; uninstall is clean | 0.5 day |
| 5 | C | Probe SSE for TUI-state events (curl -N, document findings) | 0.5 day |
| 6 | C | Extend SessionState with TUI fields, wire EventStream observation | 1 day |
| 7 | C | Update /status and /session pin to honor TUI state | 0.5 day |
| 8 | B | Add /diff, /todo, /context commands + tests | 1.5 days |
| 9 | B | Inline tool-call rendering in relay + tests | 1.5 days |
| 10 | B | Push module + finished-session + test-failed heuristics | 1 day |
| 11 | All | Smoke test full workflow end to end | 1 day |
| 12 | All | Tag v0.4.0-rc.1, write CHANGELOG | 0.5 day |

Total: ~10 working days.

---

## Definition of done

- [ ] `npm start` brings up serve + bot with zero extra terminal windows
- [ ] `scripts/install-launchd.sh` on a clean macOS account → bot online without
      manual edits
- [ ] Launcher restarts opencode serve if it dies; cleanly terminates everything
      on SIGTERM
- [ ] `/diff`, `/todo`, `/context` commands all render cards matching the
      designs above
- [ ] Coding task in bot shows inline `▸ tool · args` lines as the agent runs
- [ ] Push notification arrives after a long task completes (engaged-recently)
- [ ] `/status` reflects the TUI's current selected session, agent, and model
- [ ] Switching sessions in TUI → bot reflects within 2s
- [ ] All existing tests still pass; new tests for relay-tools, push, state
      sync, launcher spawn
- [ ] `npm test` ≥ 60 tests; `npx tsc --noEmit` clean
- [ ] CHANGELOG.md updated with v0.4.0 entry
- [ ] `git tag v0.4.0-rc.1` ready for review

---

## Risks

| Risk | Mitigation |
|------|------------|
| Subprocess management leaks orphans on crash | Trap SIGTERM/SIGINT/SIGHUP, kill children with timeout fallback. Acceptance test: kill -9 launcher, verify no orphan opencode |
| TUI-state SSE events may not exist or shape may differ | Track C step 1 is explicitly a probe step. If events don't carry needed info, fall back to polling `/session/{id}` every 5s (degrades but works) |
| Tool-part rendering floods the message past 4096 chars | Cap tool-call lines at 30 per message; if exceeded, emit "…X more tool calls" and stop appending |
| Push notifications spam the user | Strict heuristics: engaged-recently for finished, `\b(FAIL|error:)\b` regex for test-failed, opt-out env var, hard cap of 10 push/hour |
| Launcher complicates dev iteration (npm start does too much) | Keep `npm run dev` (or `node dist/index.js` directly) for raw bot start; launcher is for production |
| Track B's inline tool rendering breaks existing streaming UX | Feature-flag with `TOOL_CALLS_INLINE=true` (default true); revert by toggling if regression |

---

## Out of scope for Sprint 4

- Multi-tenant bot (still single user per install)
- Web UI (separate Phase 4 / spec)
- Discord, Feishu, Slack channels
- Image / file attachments in cards
- Voice input
- Cross-session push notifications
- Mobile push (Telegram covers this natively; PWA covers it in Web UI sprint)
