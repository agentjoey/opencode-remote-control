# Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize startup (single command launcher), close TUI/bot information gap (/diff, /todo, /context, inline tool calls, push), bidirectional state sync.

**Architecture:** Add `src/launcher/` (subprocess management + lifecycle). Extend `src/core/state.ts` with TUI-observed fields. Add `src/core/push.ts` for selective notifications. Add `src/core/tool-render.ts` for tool-call summary lines. New Telegram handlers for /diff, /todo, /context.

**Tech Stack:** Same as Phase 3 + `node:child_process` for subprocess management.

**Reference:** `docs/superpowers/specs/2026-05-16-phase4-productization-design.md` for design rationale.

**Prereqs:** Phase 3 complete. `src/core/` and `src/transport/telegram/` exist. `client.session.prompt()` is the primary submission path.

---

## Task 1: Subprocess spawn helper

**Files:**
- Create: `src/launcher/spawn.ts`
- Create: `tests/unit/spawn.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/spawn.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createSupervisor } from '../../src/launcher/spawn'

describe('createSupervisor', () => {
  it('spawns a child and exposes pid', async () => {
    const sup = createSupervisor({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      logFile: '/dev/null',
    })
    await sup.start()
    expect(sup.pid).toBeGreaterThan(0)
    await sup.stop()
  })

  it('restarts child on unexpected exit with backoff', async () => {
    let exits = 0
    const sup = createSupervisor({
      command: 'node',
      args: ['-e', 'process.exit(1)'],
      logFile: '/dev/null',
      restartBackoffMs: [50, 100],
      onExit: () => { exits++ },
    })
    await sup.start()
    await new Promise((r) => setTimeout(r, 500))
    expect(exits).toBeGreaterThanOrEqual(2)
    await sup.stop()
  })

  it('stop() kills child cleanly', async () => {
    const sup = createSupervisor({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      logFile: '/dev/null',
    })
    await sup.start()
    const pid = sup.pid
    await sup.stop()
    // Verify process gone (best-effort)
    try {
      process.kill(pid!, 0)
      throw new Error(`process ${pid} still alive`)
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('ESRCH')
    }
  })
})
```

- [ ] **Step 2: Run → fail**

```bash
npx vitest run tests/unit/spawn.test.ts
```

- [ ] **Step 3: Implement spawn.ts**

```typescript
// src/launcher/spawn.ts
import { spawn, ChildProcess } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { createLogger } from '../utils/logger.js'

const log = createLogger('spawn')

export interface SupervisorOptions {
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  logFile: string
  restartBackoffMs?: number[]
  maxRestarts?: number
  onExit?: (code: number | null) => void
}

export interface Supervisor {
  start(): Promise<void>
  stop(): Promise<void>
  readonly pid: number | undefined
}

export function createSupervisor(opts: SupervisorOptions): Supervisor {
  const backoff = opts.restartBackoffMs ?? [2000, 4000, 8000, 16000, 30000]
  const maxRestarts = opts.maxRestarts ?? Infinity
  let child: ChildProcess | undefined
  let stopped = false
  let restarts = 0
  let logFd: number | undefined

  function spawnOnce() {
    logFd = openSync(opts.logFile, 'a')
    child = spawn(opts.command, opts.args, {
      env: { ...process.env, ...(opts.env ?? {}) },
      cwd: opts.cwd,
      stdio: ['ignore', logFd, logFd],
    })
    log.info(`spawned ${opts.command} pid=${child.pid}`)
    child.on('exit', (code) => {
      if (logFd !== undefined) { closeSync(logFd); logFd = undefined }
      log.warn(`child exited code=${code}`)
      opts.onExit?.(code)
      if (stopped || restarts >= maxRestarts) return
      const delay = backoff[Math.min(restarts, backoff.length - 1)]
      restarts += 1
      log.info(`restart in ${delay}ms (attempt ${restarts})`)
      setTimeout(spawnOnce, delay)
    })
  }

  return {
    start: async () => { stopped = false; spawnOnce() },
    stop: async () => {
      stopped = true
      if (child && !child.killed) {
        child.kill('SIGTERM')
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (child && !child.killed) child.kill('SIGKILL')
            resolve()
          }, 2000)
          child!.once('exit', () => { clearTimeout(timer); resolve() })
        })
      }
      if (logFd !== undefined) { closeSync(logFd); logFd = undefined }
    },
    get pid() { return child?.pid },
  }
}
```

- [ ] **Step 4: Run tests → pass**

```bash
npx vitest run tests/unit/spawn.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/launcher/spawn.ts tests/unit/spawn.test.ts
git commit -m "feat(launcher): subprocess supervisor with restart backoff"
```

---

## Task 2: Launcher entry point + extract runBot

**Files:**
- Create: `src/launcher/index.ts`
- Modify: `src/index.ts` (already exports `runBot` from Phase 3 Task 9)
- Modify: `package.json` — `"start": "node dist/launcher.js"`, `"bin"` entry
- Modify: `src/config.ts` — add SPAWN_OPENCODE, OPENCODE_BIN, OPENCODE_PROJECT, LOG_DIR
- Modify: `.env.example`

- [ ] **Step 1: Update config.ts**

Add to schema:

```typescript
SPAWN_OPENCODE: z.string().optional().default('true').transform((v) => v === 'true'),
OPENCODE_BIN: z.string().optional().default('opencode'),
OPENCODE_PROJECT: z.string().optional().default(process.cwd()),
LOG_DIR: z.string().optional().default('./data/logs'),
```

Add to `Config` interface + `loadConfig()` return.

- [ ] **Step 2: Update .env.example**

```
# Launcher: spawn opencode serve if not already running on OPENCODE_BASE_URL
SPAWN_OPENCODE=true

# Path or name of the opencode binary (looked up via PATH)
OPENCODE_BIN=opencode

# Directory passed as opencode serve's working dir (defaults to current)
# OPENCODE_PROJECT=/path/to/project

# Where launcher writes opencode-serve.log and bot crashes
LOG_DIR=./data/logs
```

- [ ] **Step 3: Implement launcher/index.ts**

```typescript
// src/launcher/index.ts
import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { createSupervisor } from './spawn.js'
import { checkHealth } from '../opencode/client.js'
import { runBot } from '../index.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('launcher')

async function waitForHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await checkHealth(baseUrl)) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`opencode failed health check at ${baseUrl} within ${timeoutMs}ms`)
}

async function main() {
  const cfg = loadConfig()
  log.info(`launcher starting, opencode=${cfg.opencodeBaseUrl}, spawn=${cfg.spawnOpencode}`)

  mkdirSync(cfg.logDir, { recursive: true })

  const ownSupervisor =
    cfg.spawnOpencode && !(await checkHealth(cfg.opencodeBaseUrl))
      ? createSupervisor({
          command: cfg.opencodeBin,
          args: ['serve', '--port', new URL(cfg.opencodeBaseUrl).port || '4096'],
          cwd: cfg.opencodeProject,
          logFile: join(cfg.logDir, 'opencode-serve.log'),
        })
      : undefined

  if (ownSupervisor) {
    await ownSupervisor.start()
    log.info(`spawned opencode serve pid=${ownSupervisor.pid}`)
  } else {
    log.info('using external opencode serve')
  }

  await waitForHealth(cfg.opencodeBaseUrl)
  log.info('opencode healthy, starting bot')

  const shutdown = async (sig: string) => {
    log.info(`${sig} received, shutting down`)
    if (ownSupervisor) await ownSupervisor.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  await runBot()
}

main().catch((err) => {
  log.error('launcher fatal', err as Error)
  process.exit(1)
})
```

- [ ] **Step 4: Update package.json**

```json
{
  "scripts": {
    "start": "node dist/launcher.js",
    "start:dev": "node dist/index.js",
    ...
  },
  "bin": {
    "opencode-remote-control": "dist/launcher.js",
    "oprc": "dist/launcher.js"
  }
}
```

- [ ] **Step 5: Build + verify launcher works**

```bash
npm run build
npm start
```

Expected: bot starts, with opencode either already running or freshly spawned.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(launcher): single-command start with opencode supervisor"
```

---

## Task 3: launchd plist + install scripts

**Files:**
- Modify: `deploy/ai.opencode.remote-control.telegram.plist` (point at launcher.js)
- Create: `scripts/install-launchd.sh`
- Create: `scripts/uninstall.sh`

- [ ] **Step 1: Update plist**

Change `<key>ProgramArguments</key>` array:
```xml
<array>
  <string>/usr/local/bin/node</string>
  <string>dist/launcher.js</string>
</array>
```

Remove `KeepAlive` (launcher does its own recovery for opencode; bot crashes still keep launchd alive via default behavior if you re-add `KeepAlive=true` — recommend keeping `KeepAlive=true` on the bot side for crash recovery, removing only opencode-specific restart logic, since launcher handles that).

Actually keep `KeepAlive=true` for the launcher itself.

- [ ] **Step 2: Write install-launchd.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="$PROJECT_DIR/deploy/ai.opencode.remote-control.telegram.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist"

if ! command -v node &> /dev/null; then
  echo "node not found on PATH; install Node 20+ and retry"
  exit 1
fi
if ! command -v opencode &> /dev/null; then
  echo "opencode not found on PATH; install opencode CLI first"
  echo "  https://opencode.ai/docs/install"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/dist/launcher.js" ]; then
  echo "dist/launcher.js missing — running npm run build"
  ( cd "$PROJECT_DIR" && npm run build )
fi

sed "s|PROJECT_DIR|$PROJECT_DIR|g" "$PLIST_SRC" > "$PLIST_DEST"
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null || launchctl load "$PLIST_DEST"

echo "Installed. Service: ai.opencode.remote-control.telegram"
echo "Logs: /tmp/opencode-remote-control-telegram.{log,err}"
echo "Stop:  launchctl bootout gui/$(id -u) $PLIST_DEST"
```

- [ ] **Step 3: Write uninstall.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Uninstalled."
```

- [ ] **Step 4: Make executable**

```bash
chmod +x scripts/install-launchd.sh scripts/uninstall.sh
```

- [ ] **Step 5: Smoke test install**

```bash
./scripts/install-launchd.sh
launchctl list | grep ai.opencode
./scripts/uninstall.sh
```

- [ ] **Step 6: Commit**

```bash
git add scripts/ deploy/
git commit -m "feat: install-launchd.sh + uninstall.sh"
```

---

## Task 4: Live test — kill opencode, launcher recovers

- [ ] **Step 1: Run launcher**

```bash
npm start
```

- [ ] **Step 2: In another terminal, kill opencode**

```bash
lsof -ti :4096 | xargs kill
```

- [ ] **Step 3: Observe launcher restart it**

Tail `data/logs/opencode-serve.log` and launcher stdout. Expect: launcher logs "child exited", "restart in 2000ms", then "spawned opencode serve" with new pid. Within ~10s, `/status` in Telegram should respond again.

- [ ] **Step 4: Kill -9 launcher, verify no orphan opencode**

```bash
ps aux | grep opencode  # note opencode-serve pid
kill -9 <launcher-pid>
sleep 3
ps aux | grep opencode  # opencode-serve should be gone
```

If orphan remains, fix the SIGKILL fallback in spawn.ts (review `stop()` logic).

- [ ] **Step 5: Commit any fixes**

---

## Task 5: Probe SSE for TUI-state events

- [ ] **Step 1: Start opencode + curl the event stream**

```bash
curl -N http://localhost:4096/event > /tmp/events.log &
EVENTS_PID=$!
```

- [ ] **Step 2: In TUI, switch sessions / cycle agents / open model picker**

Trigger 5-6 state changes.

- [ ] **Step 3: Stop curl, inspect log**

```bash
kill $EVENTS_PID
less /tmp/events.log
```

Look for event types that carry:
- Currently-selected session id in the TUI
- Current agent name when changed

Document findings in `docs/superpowers/specs/2026-05-16-phase4-tui-state-events.md`.

If no event carries this directly, fall back to polling `client.session.get` every 5s in Track C.6 below — already in spec risks.

---

## Task 6: Extend SessionState with TUI-observed fields

**Files:**
- Modify: `src/core/state.ts`
- Modify: `tests/unit/state.test.ts`

- [ ] **Step 1: Add new methods to SessionState interface**

```typescript
// Already has: getLastSessionId, setLastSessionId, getNextAgent, setNextAgent, ...
// Add:
getTuiSelectedSession(): string | undefined
setTuiSelectedSession(id: string | undefined): void
getCurrentAgent(): string | undefined
setCurrentAgent(name: string | undefined): void
```

Add to `PersistedState`:

```typescript
tuiSelectedSession?: string
currentAgent?: string
```

Wire up in `createFileBackedState` — same pattern as existing methods.

- [ ] **Step 2: Add tests**

```typescript
it('round-trips tuiSelectedSession + currentAgent', async () => {
  const path = join(dir, 'state.json')
  const a = createFileBackedState(path)
  a.setTuiSelectedSession('ses_xyz')
  a.setCurrentAgent('build')
  await a.flush()
  const b = createFileBackedState(path)
  expect(b.getTuiSelectedSession()).toBe('ses_xyz')
  expect(b.getCurrentAgent()).toBe('build')
})
```

- [ ] **Step 3: Run tests → pass**

- [ ] **Step 4: Commit**

```bash
git add src/core/state.ts tests/unit/state.test.ts
git commit -m "feat(core/state): track TUI-observed session + agent"
```

---

## Task 7: TUI-sync subscriber

**Files:**
- Create: `src/core/tui-sync.ts`
- Create: `tests/unit/tui-sync.test.ts`
- Modify: `src/index.ts` (runBot) — wire up

- [ ] **Step 1: Implement tui-sync.ts**

```typescript
// src/core/tui-sync.ts
import type { EventStream } from '../opencode/event-stream.js'
import type { SessionState } from './state.js'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tui-sync')

interface SyncDeps {
  eventStream: EventStream
  state: SessionState
  client: OpencodeClient
  pollIntervalMs?: number
}

export function startTuiSync(deps: SyncDeps): () => void {
  // Subscribe to events; whenever we see a sessionID in any event,
  // update tuiSelectedSession. (After probe: if a more specific event
  // type carries this, narrow the filter.)
  const unsub = deps.eventStream.onAny((rawEvent) => {
    const e = rawEvent as { properties?: any }
    const p = e?.properties
    const sid =
      (typeof p?.sessionID === 'string' && p.sessionID) ||
      (typeof p?.part?.sessionID === 'string' && p.part.sessionID) ||
      (typeof p?.info?.sessionID === 'string' && p.info.sessionID) ||
      undefined
    if (sid) deps.state.setTuiSelectedSession(sid)
  })

  // Poll the selected session to refresh current agent
  const poll = deps.pollIntervalMs ?? 5000
  const timer = setInterval(async () => {
    const sid = deps.state.getTuiSelectedSession()
    if (!sid) return
    try {
      const res = await deps.client.session.get({ path: { id: sid } } as any)
      const data = res.data as { agent?: string } | undefined
      if (data?.agent) deps.state.setCurrentAgent(data.agent)
    } catch (err) {
      log.debug('poll session.get failed', (err as Error).message)
    }
  }, poll)

  return () => {
    unsub?.()
    clearInterval(timer)
  }
}
```

- [ ] **Step 2: Add tests with a fake EventStream + state + client.session.get**

(Similar to relay test patterns.)

- [ ] **Step 3: Wire into runBot in src/index.ts**

```typescript
import { startTuiSync } from './core/tui-sync.js'
// ...
const stopSync = startTuiSync({ eventStream, state, client })
// On shutdown: stopSync()
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(core): TUI-sync subscriber for selected session + current agent"
```

---

## Task 8: Update /status and /session pin

**Files:**
- Modify: `src/transport/telegram/handlers.ts`

- [ ] **Step 1: Update /status to read TUI-observed state**

```typescript
deps.bot.command('status', async (ctx) => {
  const healthy = await checkHealth(deps.baseUrl)
  // ...existing session count + busy fetch...
  const tuiSession = deps.state.getTuiSelectedSession()
  const currentAgent = deps.state.getCurrentAgent()
  const nextAgent = deps.state.getNextAgent()
  const nextModel = deps.state.getNextModel()
  const lines = [
    `<b>${healthy ? '🟢' : '🔴'} opencode ${healthy ? 'healthy' : 'unreachable'}</b>`,
    '',
    `📊 ${totalSessions} session${totalSessions !== 1 ? 's' : ''}  ·  ${busyCount} busy`,
    ...(tuiSession ? [`📌 <code>…${tuiSession.slice(-8)}</code>${currentAgent ? ` (${currentAgent})` : ''}`] : []),
    ...(nextAgent ? [`🤖 Next-agent override: <b>${nextAgent}</b>`] : []),
    ...(nextModel ? [`⚙️ Next-model override: <code>${nextModel.providerID}/${nextModel.modelID}</code>`] : []),
  ]
  // ...send card...
})
```

- [ ] **Step 2: Update /session pin to call /tui/select-session**

```typescript
deps.bot.command('session', async (ctx) => {
  // existing arg parsing
  if (args) {
    deps.state.setLastSessionId(args)
    try {
      await fetch(`${deps.baseUrl}/tui/select-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionID: args }),
        signal: AbortSignal.timeout(5000),
      })
    } catch {}
    // ...
  }
})
```

- [ ] **Step 3: Smoke test**

In Telegram: switch session in TUI → `/status` reflects within 2s. `/session pin <id>` → TUI navigates.

- [ ] **Step 4: Commit**

```bash
git add src/transport/telegram/handlers.ts
git commit -m "feat(telegram): /status reflects TUI state; /session pin syncs to TUI"
```

---

## Task 9: /diff /todo /context commands

**Files:**
- Modify: `src/transport/telegram/handlers.ts`
- Create: `tests/unit/info-commands.test.ts`

- [ ] **Step 1: Implement /diff**

```typescript
deps.bot.command('diff', async (ctx) => {
  const last = deps.state.getLastSessionId()
  if (!last) {
    await ctx.reply('<b>📝 Diff</b>\n\nNo session yet.', { parse_mode: 'HTML' })
    return
  }
  try {
    const res = await fetch(`${deps.baseUrl}/session/${last}/diff`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const diffs = (await res.json()) as Array<{ path: string; patch?: string }>
    if (diffs.length === 0) {
      await ctx.reply(`<b>📝 Diff — …${last.slice(-8)}</b>\n\nNo diffs yet.`, { parse_mode: 'HTML' })
      return
    }
    const PER_FILE_MAX = 10
    const MAX_CHARS = 4000
    const lines: string[] = [`<b>📝 Diff — …${last.slice(-8)}</b>`, '']
    let total = 0
    for (const d of diffs) {
      lines.push(`<b>${d.path}</b>`)
      const patch = (d.patch ?? '').split('\n').slice(0, PER_FILE_MAX)
      const block = '<pre>' + patch.join('\n').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!)) + '</pre>'
      total += block.length
      if (total > MAX_CHARS) { lines.push('…(truncated)'); break }
      lines.push(block)
      lines.push('')
    }
    lines.push(`<i>${diffs.length} file${diffs.length > 1 ? 's' : ''}</i>`)
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  } catch (err) {
    await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
  }
})
```

- [ ] **Step 2: Implement /todo**

```typescript
deps.bot.command('todo', async (ctx) => {
  const last = deps.state.getLastSessionId()
  if (!last) { await ctx.reply('No session yet.', { parse_mode: 'HTML' }); return }
  try {
    const res = await fetch(`${deps.baseUrl}/session/${last}/todo`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const todos = (await res.json()) as Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>
    if (todos.length === 0) {
      await ctx.reply(`<b>✅ Todos — …${last.slice(-8)}</b>\n\nNo todos.`, { parse_mode: 'HTML' })
      return
    }
    const mark = (s: string) => s === 'completed' ? '✓' : s === 'in_progress' ? '▶' : '▢'
    const lines = [`<b>✅ Todos — …${last.slice(-8)}</b>`, '']
    for (const t of todos) lines.push(`${mark(t.status)}  ${t.content}`)
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  } catch (err) {
    await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
  }
})
```

- [ ] **Step 3: Implement /context**

```typescript
deps.bot.command('context', async (ctx) => {
  const last = deps.state.getLastSessionId()
  if (!last) { await ctx.reply('No session yet.', { parse_mode: 'HTML' }); return }
  try {
    const sRes = await fetch(`${deps.baseUrl}/session/${last}`, { signal: AbortSignal.timeout(5000) })
    const s = (await sRes.json()) as {
      agent?: string
      tokens?: { input?: number; output?: number; cache?: number }
      cost?: number
    }
    const cRes = await fetch(`${deps.baseUrl}/config`, { signal: AbortSignal.timeout(5000) })
    const c = (await cRes.json()) as { agent?: Record<string, { model?: string }> }
    const model = s.agent && c.agent?.[s.agent]?.model
    const lines = [
      `<b>📊 Context — …${last.slice(-8)}</b>`,
      '',
      `Agent:    ${s.agent ?? '?'}`,
      `Model:    <code>${model ?? '?'}</code>`,
      `Tokens:   ${s.tokens?.input ?? 0} in · ${s.tokens?.output ?? 0} out · ${s.tokens?.cache ?? 0} cache`,
      `Cost:     $${(s.cost ?? 0).toFixed(2)}`,
    ]
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  } catch (err) {
    await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
  }
})
```

- [ ] **Step 4: Add unit tests** for command handlers (registration + basic shape).

- [ ] **Step 5: Smoke test in Telegram** — run a coding task, then `/diff /todo /context`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(telegram): /diff, /todo, /context commands"
```

---

## Task 10: Inline tool-call rendering in relay

**Files:**
- Modify: `src/core/relay.ts`
- Modify: `tests/unit/relay.test.ts`

- [ ] **Step 1: Update relay loop to capture tool parts**

In the for-await loop, alongside text part tracking, capture tool parts:

```typescript
const toolEvents: string[] = []   // accumulating "▸ tool · args" lines

// In message.part.updated branch:
if (p?.part?.type === 'tool' && typeof p.part.tool === 'string') {
  const tool = p.part.tool
  const input = p.part.state?.input ?? {}
  const arg = summarizeToolArgs(tool, input)
  toolEvents.push(`▸ ${tool}${arg ? ` · ${arg}` : ''}`)
  // Append to streamedText so next edit shows it
  if (streamedText) streamedText += '\n'
  streamedText += toolEvents[toolEvents.length - 1]
  if (deps.transport.capabilities.edit && Date.now() - lastEdit >= deps.editThrottleMs) {
    await deps.transport.edit(msg.chatId, initial.messageId, textCard(streamedText))
    lastEdit = Date.now()
  }
}
```

- [ ] **Step 2: Add summarizeToolArgs helper**

```typescript
function summarizeToolArgs(tool: string, input: any): string {
  if (tool === 'bash') return (input.command ?? '').slice(0, 60)
  if (tool === 'read' || tool === 'edit' || tool === 'write') return input.filePath ?? ''
  if (tool === 'grep' || tool === 'find') return input.pattern ?? input.query ?? ''
  return ''
}
```

- [ ] **Step 3: Cap tool lines at 30 per message** to avoid 4096 char overrun.

```typescript
const MAX_TOOL_LINES = 30
// In capture:
if (toolEvents.length === MAX_TOOL_LINES + 1) {
  streamedText += '\n…more tool calls suppressed'
}
if (toolEvents.length > MAX_TOOL_LINES) return  // skip further appends
```

- [ ] **Step 4: Add feature flag TOOL_CALLS_INLINE in config (default true)**

```typescript
TOOL_CALLS_INLINE: z.string().optional().default('true').transform((v) => v === 'true'),
```

Wire into RelayDeps, gate the tool-rendering block on it.

- [ ] **Step 5: Add tests for the tool emission path**

```typescript
it('emits ▸ tool · args line on tool part', async () => {
  const transport = fakeTransport()
  const relay = createRelay({
    transport, /* ... */
    eventStream: fakeEventStream([
      { type: 'message.part.updated', properties: { messageID: 'm1', part: { type: 'tool', tool: 'bash', state: { input: { command: 'ls' } } } } },
      { type: 'session.idle', properties: {} },
    ]),
    /* ... */
  })
  await relay({ userId: '1', chatId: '100', text: 'x', messageId: 'msg' })
  const last = transport.edits[transport.edits.length - 1]
  expect(last.lines.join('\n')).toMatch(/▸ bash · ls/)
})
```

- [ ] **Step 6: Smoke test** — run a real coding task; verify tool lines interleave with text.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(relay): inline ▸ tool · args rendering with TOOL_CALLS_INLINE flag"
```

---

## Task 11: Push notifications module

**Files:**
- Create: `src/core/push.ts`
- Create: `tests/unit/push.test.ts`
- Modify: `src/index.ts` (runBot) — start push

- [ ] **Step 1: Implement push.ts**

```typescript
// src/core/push.ts
import type { EventStream } from '../opencode/event-stream.js'
import type { Transport } from '../transport/interface.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('push')

export interface PushDeps {
  eventStream: EventStream
  transport: Transport
  chatId: string                 // single allowed user's chat id
  testFailuresEnabled?: boolean
  maxPerHour?: number
}

export function startPushNotifications(deps: PushDeps): () => void {
  const hourCap = deps.maxPerHour ?? 10
  const sessionCooldownMs = 5 * 60 * 1000
  const recentPushes: number[] = []        // timestamps within last hour
  const lastSessionPush = new Map<string, number>()
  const engagedAt = new Map<string, number>()  // sessionId → last activity ts
  const busySince = new Map<string, number>()  // sessionId → busy start ts

  function canPush(sessionId: string): boolean {
    const now = Date.now()
    // Hour cap
    while (recentPushes.length && now - recentPushes[0] > 60 * 60 * 1000) recentPushes.shift()
    if (recentPushes.length >= hourCap) return false
    // Per-session cooldown
    const last = lastSessionPush.get(sessionId) ?? 0
    if (now - last < sessionCooldownMs) return false
    return true
  }

  function recordPush(sessionId: string) {
    const now = Date.now()
    recentPushes.push(now)
    lastSessionPush.set(sessionId, now)
  }

  function recordEngagement(sessionId: string) {
    engagedAt.set(sessionId, Date.now())
  }

  const unsub = deps.eventStream.onAny(async (raw) => {
    const e = raw as { type: string; properties?: any }
    const p = e.properties
    const sid =
      (typeof p?.sessionID === 'string' && p.sessionID) ||
      (typeof p?.part?.sessionID === 'string' && p.part.sessionID) ||
      undefined
    if (!sid) return

    // Engagement = anything happening in this session
    recordEngagement(sid)

    // Track busy → idle transitions for "long task finished"
    if (e.type === 'session.status' && p?.status?.type === 'busy') {
      if (!busySince.has(sid)) busySince.set(sid, Date.now())
    } else if (e.type === 'session.idle' || (e.type === 'session.status' && p?.status?.type === 'idle')) {
      const start = busySince.get(sid)
      busySince.delete(sid)
      if (!start) return
      const duration = Date.now() - start
      const lastEngaged = engagedAt.get(sid) ?? 0
      const engagedRecently = Date.now() - lastEngaged < 60 * 60 * 1000
      if (duration > 60_000 && engagedRecently && canPush(sid)) {
        recordPush(sid)
        await deps.transport.send(deps.chatId, {
          lines: [`✅ Session <code>…${sid.slice(-8)}</code> finished (${Math.round(duration/1000)}s)`],
        }).catch(() => {})
      }
    }

    // Test-failed heuristic
    if (deps.testFailuresEnabled !== false && e.type === 'message.part.updated') {
      const part = p?.part
      if (part?.type === 'tool' && part.tool === 'bash' && part.state?.output) {
        const tail = (part.state.output as string).slice(-200)
        if (/\b(FAIL|FAILED|error:|✗)\b/.test(tail) && canPush(sid)) {
          recordPush(sid)
          await deps.transport.send(deps.chatId, {
            lines: [`⚠️ Possible test failure in <code>…${sid.slice(-8)}</code>`, '<pre>' + tail.replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!)) + '</pre>'],
          }).catch(() => {})
        }
      }
    }
  })

  return () => { unsub?.() }
}
```

- [ ] **Step 2: Add unit tests**

Test: simulated SSE sequence triggers finished push after >60s busy → idle when engaged recently, suppresses otherwise, respects hour cap + cooldown.

- [ ] **Step 3: Wire into runBot in src/index.ts**

```typescript
import { startPushNotifications } from './core/push.js'
// after transport.start():
const stopPush = startPushNotifications({
  eventStream,
  transport,
  chatId: String(config.allowedUserId),
})
```

- [ ] **Step 4: Add PUSH_TEST_FAILURES env to config** (default true)

- [ ] **Step 5: Smoke test**

Trigger a long task; verify the "✅ finished" push arrives only when engaged-recently.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): selective push notifications for long tasks and test failures"
```

---

## Task 12: End-to-end smoke + tag

- [ ] **Step 1: Run full test suite**

```bash
npm test && npx tsc --noEmit
```

Expected: ≥ 60 tests, clean.

- [ ] **Step 2: 24h soak in background**

Start launcher, leave running. Check after 24h:
- `launchctl list | grep ai.opencode` → exit count 0
- `wc -l /tmp/opencode-remote-control-telegram.err` → low
- No memory leak: `ps aux | grep "dist/launcher" | awk '{print $6}'` stable

- [ ] **Step 3: Manual smoke checklist**

In Telegram:
- [ ] `/start` → card with healthy
- [ ] Send "hello" → streamed response
- [ ] Coding task: send "list files in src/" → response includes `▸ bash · ls -la` interleaved
- [ ] After long task (>60s, engaged session): receive "✅ finished" push
- [ ] `/diff`, `/todo`, `/context` all render
- [ ] `/agent` → list → tap → next message uses that agent
- [ ] `/model` → list → tap → next message uses that model
- [ ] `/sessions` → list with pin buttons
- [ ] `/session pin <id>` → TUI navigates
- [ ] Restart bot → state persists
- [ ] Kill opencode → launcher restarts; bot continues after recovery

- [ ] **Step 4: Update CHANGELOG.md** with v0.4.0 entry

- [ ] **Step 5: Update .agent/CURRENT.md and BACKLOG.md**

- [ ] **Step 6: Tag (do not push — user reviews)**

```bash
git tag v0.4.0-rc.1
```

- [ ] **Step 7: Report back to user with summary**

---

## Final acceptance checklist (per design spec)

- [ ] `npm start` brings up bot + spawned opencode serve, zero extra terminals
- [ ] `scripts/install-launchd.sh` works on a clean macOS account
- [ ] Kill `opencode serve` → launcher restarts within 10s
- [ ] Kill -9 launcher → no orphan `opencode serve`
- [ ] `/diff`, `/todo`, `/context` render
- [ ] Coding task shows `▸ tool · args` inline
- [ ] Push fires for long task (engaged-recently)
- [ ] `/status` reflects TUI's current selection + agent within 2s
- [ ] `/session pin <id>` syncs TUI
- [ ] All tests pass; `npx tsc --noEmit` clean
- [ ] `npm test` ≥ 60 tests
- [ ] CHANGELOG.md updated
- [ ] `git tag v0.4.0-rc.1` ready
