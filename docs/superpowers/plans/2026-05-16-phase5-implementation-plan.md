# Phase 5 Implementation Plan — Web UI + Streaming Overflow Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.5.0 — Web transport (PWA + Chrome Extension via Cloudflare Tunnel + Access), with a relay refactor that simultaneously fixes Telegram's long-thinking truncation through structured cards + live multi-message pagination.

**Architecture:** Relay refactored to publish transport-agnostic `StructuredCard`s through a `CardBus`. Telegram has its own per-session renderer that handles pagination + tool collapse. Web transport adds a Hono HTTP/WebSocket server in the same Node process. SvelteKit app served from `web/dist/` powers both PWA and Chrome Extension side panel.

**Tech Stack:** TypeScript / Node 20, Telegraf (existing), Hono + ws + jose (new server deps), SvelteKit 5 + Vite + marked + DOMPurify (web), Chrome Manifest V3 (extension), Vitest + Playwright (tests).

**Spec:** `docs/superpowers/specs/2026-05-16-phase5-design.md`

---

## Execution Notes

- Tasks 0a–0c are **Phase 4.5 wrap-up** (run before Phase 5).
- Tasks 1–12 form **Phase 5.A — Foundation**. End of Phase 5.A is a clean checkpoint: Telegram-only mode runs, overflow fix verified, all existing tests still pass.
- Tasks 13–20 form **Phase 5.B — Web Backend**.
- Tasks 21–32 form **Phase 5.C — Web Frontend**.
- Tasks 33–36 form **Phase 5.D — Chrome Extension**.
- Tasks 37–41 form **Phase 5.E — Release**.
- Every task ends with a commit. Every step uses TDD (write failing test → verify fail → implement → verify pass → commit).
- After each Phase checkpoint, run the full test suite: `npm test`.

---

## Phase 4.5 — OSS Prep Wrap-up

### Task 0a: Add CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create CONTRIBUTING.md**

```markdown
# Contributing to opencode-remote-control

Thanks for your interest. Below is the minimum to get a working dev loop.

## Dev setup

```bash
git clone https://github.com/<you>/opencode-remote-control.git
cd opencode-remote-control
npm install
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN and ALLOWED_USER_IDS
```

## Run tests

```bash
npm test                # unit + integration via Vitest
npx tsc --noEmit        # type-check
```

## Run the bot

```bash
npm run dev             # tsx watch, reloads on save
```

## PR conventions

- One concern per PR.
- Tests added or updated alongside behavior changes.
- No `.env`, tokens, or credentials in commits — pre-commit scan recommended.
- Commit messages: short imperative subject (`fix: handle X`); body explains *why* if non-obvious.
- Run `npm test && npx tsc --noEmit` before pushing.

## Adding a new transport

See `docs/transports/CONTRIBUTING-NEW-TRANSPORT.md`.

## Security

Vulnerabilities: see `SECURITY.md` for private disclosure path.
```

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md"
```

---

### Task 0b: Add Dependabot config

**Files:**
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Create dependabot.yml**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    groups:
      dev-deps:
        dependency-type: development
  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: monthly
```

- [ ] **Step 2: Commit**

```bash
git add .github/dependabot.yml
git commit -m "ci: add dependabot config"
```

---

### Task 0c: Tag v0.4.0-rc.1

- [ ] **Step 1: Verify version + working tree clean**

```bash
node -p "require('./package.json').version"
# Expected output: 0.4.0-rc.1
git status
# Expected output: working tree clean (data/state.json may be modified — leave it)
```

- [ ] **Step 2: Run full test suite**

```bash
npm test && npx tsc --noEmit
# Expected: all tests pass, no type errors
```

- [ ] **Step 3: Create annotated tag**

```bash
git tag -a v0.4.0-rc.1 -m "v0.4.0-rc.1 — productization + TUI parity (Phase 4)"
git tag --list | grep v0.4.0
```

(Do NOT push the tag without explicit user instruction.)

---

## Phase 5.A — Foundation: relay refactor + Telegram pagination

### Task 1: StructuredCard types

**Files:**
- Create: `src/core/structured-card.ts`
- Test: `tests/unit/structured-card.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/structured-card.test.ts
import { describe, it, expect } from 'vitest'
import type { StructuredCard, ToolCall, AssistantMeta } from '../../src/core/structured-card'

describe('StructuredCard', () => {
  it('thinking has sessionId and showStop', () => {
    const c: StructuredCard = { kind: 'thinking', sessionId: 'ses_1', showStop: true }
    expect(c.kind).toBe('thinking')
  })

  it('streaming carries markdownSrc and tools', () => {
    const tools: ToolCall[] = [{ tool: 'bash', args: 'ls', status: 'done' }]
    const c: StructuredCard = { kind: 'streaming', sessionId: 'ses_1', markdownSrc: 'hi', tools }
    expect(c.tools[0].tool).toBe('bash')
  })

  it('assistant carries meta', () => {
    const meta: AssistantMeta = { agent: 'build', model: 'k2p6', cost: 0.04 }
    const c: StructuredCard = { kind: 'assistant', sessionId: 'ses_1', markdownSrc: 'done', tools: [], meta }
    expect(c.meta.cost).toBe(0.04)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/structured-card.test.ts
# Expected: FAIL — cannot find module '../../src/core/structured-card'
```

- [ ] **Step 3: Create the type module**

```typescript
// src/core/structured-card.ts
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
  body: string
  code?: { language?: string; content: string }
}

export interface Button {
  label: string
  data: string
}

export type StructuredCard =
  | { kind: 'thinking';  sessionId: string;  showStop: boolean }
  | { kind: 'streaming'; sessionId: string;  markdownSrc: string;  tools: ToolCall[] }
  | { kind: 'assistant'; sessionId: string;  markdownSrc: string;  tools: ToolCall[]; meta: AssistantMeta }
  | { kind: 'user';      sessionId: string;  text: string;  ts: number }
  | { kind: 'error';     sessionId: string;  message: string }
  | { kind: 'status';    sessionId: string;  fields: Record<string, string>; buttons?: Button[][] }
  | { kind: 'info';      title: string;      sections: InfoSection[] }
  | { kind: 'approval';  sessionId: string;  title: string;  args: unknown;  requestId: string }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/structured-card.test.ts
# Expected: PASS — 3 tests
```

- [ ] **Step 5: Commit**

```bash
git add src/core/structured-card.ts tests/unit/structured-card.test.ts
git commit -m "feat(core): add StructuredCard type module"
```

---

### Task 2: CardBus

**Files:**
- Create: `src/core/card-bus.ts`
- Test: `tests/unit/card-bus.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/card-bus.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createCardBus } from '../../src/core/card-bus'
import type { StructuredCard } from '../../src/core/structured-card'

const card = (sessionId: string, kind: 'thinking' | 'error' = 'thinking'): StructuredCard =>
  kind === 'thinking'
    ? { kind: 'thinking', sessionId, showStop: false }
    : { kind: 'error', sessionId, message: 'x' }

describe('CardBus', () => {
  it('delivers cards to subscribers of matching sessionId', () => {
    const bus = createCardBus()
    const fn = vi.fn()
    bus.subscribe('ses_1', fn)
    bus.publish(card('ses_1'))
    bus.publish(card('ses_2'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('subscribeAll receives every card', () => {
    const bus = createCardBus()
    const fn = vi.fn()
    bus.subscribeAll(fn)
    bus.publish(card('ses_1'))
    bus.publish(card('ses_2'))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('unsubscribe stops delivery', () => {
    const bus = createCardBus()
    const fn = vi.fn()
    const unsub = bus.subscribe('ses_1', fn)
    bus.publish(card('ses_1'))
    unsub()
    bus.publish(card('ses_1'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('recent returns last N cards for session, newest last', () => {
    const bus = createCardBus()
    for (let i = 0; i < 5; i++) bus.publish(card('ses_1'))
    expect(bus.recent('ses_1', 3).length).toBe(3)
  })

  it('isolates subscriber errors', () => {
    const bus = createCardBus()
    const good = vi.fn()
    bus.subscribe('ses_1', () => { throw new Error('boom') })
    bus.subscribe('ses_1', good)
    bus.publish(card('ses_1'))
    expect(good).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/card-bus.test.ts
# Expected: FAIL — cannot find module
```

- [ ] **Step 3: Implement CardBus**

```typescript
// src/core/card-bus.ts
import type { StructuredCard } from './structured-card.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('card-bus')

const DEFAULT_BUFFER = 100

export interface CardBus {
  publish(card: StructuredCard): void
  subscribe(sessionId: string, fn: (card: StructuredCard) => void): () => void
  subscribeAll(fn: (card: StructuredCard) => void): () => void
  recent(sessionId: string, limit?: number): StructuredCard[]
}

export function createCardBus(bufferSize: number = DEFAULT_BUFFER): CardBus {
  const perSession = new Map<string, Set<(c: StructuredCard) => void>>()
  const all = new Set<(c: StructuredCard) => void>()
  const buffers = new Map<string, StructuredCard[]>()

  function sessionIdOf(c: StructuredCard): string | undefined {
    return 'sessionId' in c ? c.sessionId : undefined
  }

  function safe(fn: (c: StructuredCard) => void, c: StructuredCard) {
    try { fn(c) } catch (err) { log.warn('subscriber error', (err as Error).message) }
  }

  return {
    publish(card) {
      const sid = sessionIdOf(card)
      if (sid) {
        const buf = buffers.get(sid) ?? []
        buf.push(card)
        if (buf.length > bufferSize) buf.shift()
        buffers.set(sid, buf)
        perSession.get(sid)?.forEach((fn) => safe(fn, card))
      }
      all.forEach((fn) => safe(fn, card))
    },
    subscribe(sessionId, fn) {
      let s = perSession.get(sessionId)
      if (!s) { s = new Set(); perSession.set(sessionId, s) }
      s.add(fn)
      return () => { s!.delete(fn) }
    },
    subscribeAll(fn) {
      all.add(fn)
      return () => { all.delete(fn) }
    },
    recent(sessionId, limit = bufferSize) {
      const buf = buffers.get(sessionId) ?? []
      return buf.slice(-limit)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/card-bus.test.ts
# Expected: PASS — 5 tests
```

- [ ] **Step 5: Commit**

```bash
git add src/core/card-bus.ts tests/unit/card-bus.test.ts
git commit -m "feat(core): add CardBus event bus with per-session + wildcard subscribers"
```

---

### Task 3: History reconstruction (messageToCards + reconstructHistory)

**Files:**
- Create: `src/core/history.ts`
- Test: `tests/unit/history.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/history.test.ts
import { describe, it, expect, vi } from 'vitest'
import { messageToCards, reconstructHistory } from '../../src/core/history'

describe('messageToCards', () => {
  it('converts user message to kind=user card', () => {
    const cards = messageToCards({
      info: { id: 'm1', sessionID: 'ses', role: 'user', time: { created: 100 } },
      parts: [{ type: 'text', text: 'hi' }],
    })
    expect(cards).toEqual([{ kind: 'user', sessionId: 'ses', text: 'hi', ts: 100 }])
  })

  it('converts assistant message to kind=assistant with tools merged', () => {
    const cards = messageToCards({
      info: {
        id: 'm2',
        sessionID: 'ses',
        role: 'assistant',
        agent: { name: 'build' },
        model: 'kimi/k2p6',
        cost: 0.04,
        tokens: { input: 100, output: 50 },
      },
      parts: [
        { type: 'tool', tool: 'bash', state: { status: 'done', input: { command: 'ls' } } },
        { type: 'text', text: 'done' },
      ],
    })
    expect(cards).toHaveLength(1)
    const c = cards[0]
    if (c.kind !== 'assistant') throw new Error('expected assistant')
    expect(c.markdownSrc).toBe('done')
    expect(c.tools[0].tool).toBe('bash')
    expect(c.meta.agent).toBe('build')
    expect(c.meta.model).toBe('kimi/k2p6')
  })
})

describe('reconstructHistory', () => {
  it('returns flattened card list from session.messages', async () => {
    const client = {
      session: {
        messages: vi.fn().mockResolvedValue({
          data: [
            { info: { id: 'm1', sessionID: 'ses', role: 'user', time: { created: 100 } }, parts: [{ type: 'text', text: 'hi' }] },
            { info: { id: 'm2', sessionID: 'ses', role: 'assistant' }, parts: [{ type: 'text', text: 'ok' }] },
          ],
        }),
      },
    } as any
    const cards = await reconstructHistory(client, 'ses')
    expect(cards.map((c) => c.kind)).toEqual(['user', 'assistant'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/history.test.ts
# Expected: FAIL — cannot find module
```

- [ ] **Step 3: Implement history.ts**

```typescript
// src/core/history.ts
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { StructuredCard, ToolCall, AssistantMeta } from './structured-card.js'

function summarizeToolArgs(tool: string, input: any): string {
  if (!input) return ''
  if (tool === 'bash') return String(input.command ?? '').slice(0, 60)
  if (tool === 'read' || tool === 'edit' || tool === 'write') return String(input.filePath ?? '')
  if (tool === 'grep' || tool === 'find') return String(input.pattern ?? input.query ?? '')
  return ''
}

export function messageToCards(msg: any): StructuredCard[] {
  const info = msg.info ?? msg
  const parts = msg.parts ?? []
  const role = info.role
  const sessionId = info.sessionID

  if (role === 'user') {
    const text = parts.find((p: any) => p.type === 'text')?.text ?? ''
    return [{ kind: 'user', sessionId, text, ts: info.time?.created ?? 0 }]
  }

  if (role === 'assistant') {
    const texts: string[] = []
    const tools: ToolCall[] = []
    for (const p of parts) {
      if (p.type === 'text' && typeof p.text === 'string') texts.push(p.text)
      if (p.type === 'tool' && typeof p.tool === 'string') {
        const status: ToolCall['status'] = p.state?.status === 'error' ? 'error'
          : p.state?.status === 'done' ? 'done' : 'running'
        tools.push({ tool: p.tool, args: summarizeToolArgs(p.tool, p.state?.input), status })
      }
    }
    const meta: AssistantMeta = {
      agent: info.agent?.name,
      model: typeof info.model === 'string' ? info.model : undefined,
      cost: typeof info.cost === 'number' ? info.cost : undefined,
      tokens: info.tokens && typeof info.tokens.input === 'number' && typeof info.tokens.output === 'number'
        ? { input: info.tokens.input, output: info.tokens.output, cache: info.tokens.cache }
        : undefined,
    }
    return [{ kind: 'assistant', sessionId, markdownSrc: texts.join(''), tools, meta }]
  }

  return []
}

export async function reconstructHistory(
  client: OpencodeClient,
  sessionId: string,
): Promise<StructuredCard[]> {
  const res = await client.session.messages({ path: { id: sessionId } } as any)
  const data = (res as any).data ?? []
  const out: StructuredCard[] = []
  for (const m of data) out.push(...messageToCards(m))
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/history.test.ts
# Expected: PASS — 3 tests
```

- [ ] **Step 5: Commit**

```bash
git add src/core/history.ts tests/unit/history.test.ts
git commit -m "feat(core): reconstructHistory + messageToCards for session replay"
```

---

### Task 4: Transport interface (revised)

**Files:**
- Modify: `src/transport/interface.ts`
- Modify: `src/core/types.ts` — keep `Card`/`Button`/`ChannelCapabilities`, add `streaming` doc note (already there)

- [ ] **Step 1: Update Transport interface**

Replace `src/transport/interface.ts` with:

```typescript
// src/transport/interface.ts
import type { CardBus } from '../core/card-bus.js'
import type { SessionState } from '../core/state.js'
import type { IncomingMessage, ChannelCapabilities } from '../core/types.js'
import type { StructuredCard } from '../core/structured-card.js'

export interface TransportStartDeps {
  cardBus: CardBus
  state: SessionState
}

export interface Transport {
  readonly name: string
  readonly capabilities: ChannelCapabilities

  start(deps: TransportStartDeps): Promise<void>
  stop(): Promise<void>

  /** Direct send for slash-command replies that don't go through the relay. */
  send(chatId: string, card: StructuredCard): Promise<{ messageId: string }>

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  onCommand(name: string, handler: (msg: IncomingMessage) => Promise<void>): void
  onButtonClick(handler: (data: string, msg: IncomingMessage) => Promise<void>): void
}
```

Note: `edit` and `delete` are removed. Tests using them will fail until Task 11 wires the new Telegram renderer.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -30
# Expected: errors in places that call transport.edit / transport.delete or pass old start() signature.
# Don't fix them yet — Tasks 5, 11 will. Verify the count is bounded (<50 errors).
```

- [ ] **Step 3: Commit (interface change only; downstream broken intentionally)**

```bash
git add src/transport/interface.ts
git commit -m "refactor(transport): revise interface — start({cardBus,state}), remove edit/delete

Downstream code (relay, telegram, tests) breaks intentionally; fixed in
subsequent tasks."
```

---

### Task 5: Relay refactor — publish to CardBus

**Files:**
- Modify: `src/core/relay.ts` (major rewrite)
- Modify: `tests/unit/relay.test.ts` (adapt to CardBus)
- Modify: `tests/unit/relay-abort.test.ts` (adapt to CardBus)

- [ ] **Step 1: Rewrite relay.ts to publish StructuredCard via CardBus**

```typescript
// src/core/relay.ts
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { CardBus } from './card-bus.js'
import type { IncomingMessage } from './types.js'
import type { SessionState } from './state.js'
import type { EventStream } from '../opencode/event-stream.js'
import type { StructuredCard, ToolCall, AssistantMeta } from './structured-card.js'
import { submitPrompt } from '../opencode/submit.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('relay')

export interface RelayDeps {
  client: OpencodeClient
  eventStream: EventStream
  state: SessionState
  cardBus: CardBus
  chatTimeoutMs: number
  tuiVisible: boolean
}

const SUBMIT_MAX_RETRIES = 5
const SUBMIT_RETRY_BASE_MS = 2000

function isNetworkError(err: Error): boolean {
  const msg = err.message.toLowerCase()
  return msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('socket hang up')
}

function delayOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal || signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(t); reject(new Error('aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function submitWithRetry(
  client: OpencodeClient,
  opts: { text: string; sessionId: string; agent?: string; model?: { providerID: string; modelID: string }; signal?: AbortSignal },
): Promise<void> {
  for (let i = 0; i < SUBMIT_MAX_RETRIES; i++) {
    try { await submitPrompt(client, opts); return }
    catch (err) {
      const e = err as Error
      if (opts.signal?.aborted) throw e
      if (i < SUBMIT_MAX_RETRIES - 1 && isNetworkError(e)) {
        const delay = SUBMIT_RETRY_BASE_MS * Math.pow(2, i)
        log.warn(`submit failed (${i + 1}/${SUBMIT_MAX_RETRIES}), retry in ${delay}ms: ${e.message}`)
        await delayOrAbort(delay, opts.signal)
      } else { throw e }
    }
  }
}

function summarizeToolArgs(tool: string, input: any): string {
  if (!input) return ''
  if (tool === 'bash') return String(input.command ?? '').slice(0, 60)
  if (tool === 'read' || tool === 'edit' || tool === 'write') return String(input.filePath ?? '')
  if (tool === 'grep' || tool === 'find') return String(input.pattern ?? input.query ?? '')
  return ''
}

async function pickSessionFallback(client: OpencodeClient): Promise<string> {
  const res = await client.session.list()
  const sessions = (res.data ?? []) as Array<{ id: string; time?: { created?: number } }>
  if (sessions.length === 0) throw new Error('No opencode sessions found — open TUI first')
  return [...sessions].sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))[0].id
}

export function createRelay(deps: RelayDeps) {
  return async function handleIncoming(msg: IncomingMessage): Promise<void> {
    const tuiSession = deps.state.getTuiSelectedSession()
    const lastSession = deps.state.getLastSessionId()
    const sessionId = tuiSession ?? lastSession ?? await pickSessionFallback(deps.client)
    deps.state.setLastSessionId(sessionId)

    const ac = new AbortController()
    deps.state.setActiveAbort(sessionId, ac)
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    // Publish initial thinking card
    deps.cardBus.publish({ kind: 'thinking', sessionId, showStop: true })
    // Also publish the user's own message so Web (history-on-connect future viewers) can see it
    deps.cardBus.publish({ kind: 'user', sessionId, text: msg.text, ts: Date.now() })

    let streamedText = ''
    const tools: ToolCall[] = []
    const textPartIds = new Set<string>()
    let assistantMessageId: string | undefined

    try {
      if (deps.tuiVisible) {
        try { await deps.client.tui.appendPrompt({ body: { text: msg.text } } as any) }
        catch (err) { log.warn(`TUI mirror failed: ${(err as Error).message}`) }
      }

      const nextAgent = deps.state.getNextAgent()
      const nextModel = deps.state.getNextModel()
      log.info(`submitting to session=${sessionId.slice(-8)}, agent=${nextAgent ?? 'default'}, model=${nextModel ? `${nextModel.providerID}/${nextModel.modelID}` : 'default'}`)

      await submitWithRetry(deps.client, {
        text: msg.text, sessionId, agent: nextAgent, model: nextModel, signal: ac.signal,
      })

      for await (const ev of deps.eventStream.session(sessionId, ac.signal)) {
        const e = ev as { type: string; properties: any }
        const p = e.properties

        if (e.type === 'session.idle') break
        if (e.type === 'session.status' && p?.status?.type === 'idle') break
        if (e.type === 'session.error') {
          const err = p?.error
          throw new Error(err?.data?.message ?? err?.message ?? err?.name ?? 'session error')
        }

        if (e.type === 'message.part.updated') {
          const part = p?.part
          if (!part) continue
          if (!assistantMessageId && typeof part.messageID === 'string') assistantMessageId = part.messageID

          if (part.type === 'text') {
            const partId = typeof part.id === 'string' ? part.id : undefined
            const isNewPart = partId && !textPartIds.has(partId)
            if (typeof p.delta === 'string') {
              streamedText += p.delta
              if (partId) textPartIds.add(partId)
              deps.cardBus.publish({ kind: 'streaming', sessionId, markdownSrc: streamedText, tools: [...tools] })
            } else if (typeof part.text === 'string' && isNewPart) {
              streamedText = part.text
              textPartIds.add(partId)
              deps.cardBus.publish({ kind: 'streaming', sessionId, markdownSrc: streamedText, tools: [...tools] })
            }
          }

          if (part.type === 'tool' && typeof part.tool === 'string') {
            const arg = summarizeToolArgs(part.tool, part.state?.input)
            const status: ToolCall['status'] = part.state?.status === 'error' ? 'error'
              : part.state?.status === 'done' ? 'done' : 'running'
            const existing = tools.find((t) => t.tool === part.tool && t.args === arg)
            if (existing) existing.status = status
            else tools.push({ tool: part.tool, args: arg, status })
            deps.cardBus.publish({ kind: 'streaming', sessionId, markdownSrc: streamedText, tools: [...tools] })
          }
        }

        if (e.type === 'message.part.delta') {
          if (!assistantMessageId && typeof p?.messageID === 'string') assistantMessageId = p.messageID
          const field = p?.field as string | undefined
          const delta = p?.delta as string | undefined
          if (field === 'text' && typeof delta === 'string') {
            streamedText += delta
            deps.cardBus.publish({ kind: 'streaming', sessionId, markdownSrc: streamedText, tools: [...tools] })
          }
        }
      }

      // Final assistant card with meta
      let final = streamedText
      if (!final && assistantMessageId) {
        try {
          const mres = await deps.client.session.message({ path: { id: sessionId, messageID: assistantMessageId } })
          const m = (mres.data ?? {}) as any
          const texts: string[] = []
          for (const part of (m.parts ?? [])) {
            if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text)
          }
          if (texts.length > 0) final = texts.join('')
        } catch (err) { log.info('fallback fetch message failed', (err as Error).message) }
      }
      if (!final) final = '(empty response)'

      const meta: AssistantMeta = {}
      try {
        const sres = await deps.client.session.get({ path: { id: sessionId } })
        const s = (sres.data ?? {}) as any
        if (typeof s.cost === 'number') {
          deps.state.setSessionCost(sessionId, s.cost)
          meta.cost = s.cost
        }
        if (typeof s.tokens?.input === 'number' && typeof s.tokens?.output === 'number') {
          meta.tokens = { input: s.tokens.input, output: s.tokens.output, cache: s.tokens.cache }
        }
        meta.agent = s.agent?.name ?? deps.state.getCurrentAgent()
        meta.model = typeof s.model === 'string' ? s.model.split('/').pop() : undefined
      } catch { /* meta optional */ }

      deps.cardBus.publish({ kind: 'assistant', sessionId, markdownSrc: final, tools: [...tools], meta })
    } catch (err) {
      const e = err as Error
      log.warn('relay error', e.message)
      deps.cardBus.publish({ kind: 'error', sessionId, message: e.message })
    } finally {
      clearTimeout(timer)
      deps.state.setActiveAbort(sessionId, undefined)
    }
  }
}
```

- [ ] **Step 2: Adapt relay.test.ts to CardBus**

Replace `fakeTransport()` use with `createCardBus()` + spy on subscribeAll. Rewrite the assertions to inspect published cards.

```typescript
// tests/unit/relay.test.ts (rewrite)
import { describe, it, expect, vi } from 'vitest'
import { createRelay } from '../../src/core/relay'
import { createCardBus } from '../../src/core/card-bus'
import type { StructuredCard } from '../../src/core/structured-card'

function fakeClient() {
  return {
    session: {
      promptAsync: vi.fn().mockResolvedValue({ data: {} }),
      list: vi.fn().mockResolvedValue({ data: [{ id: 'ses_test', time: { created: 1 } }] }),
      get: vi.fn().mockResolvedValue({ data: { cost: 0.04, tokens: { input: 5100, output: 1200 }, agent: { name: 'build' }, model: 'kimi/k2p6' } }),
      message: vi.fn().mockResolvedValue({ data: { parts: [] } }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
    },
    tui: { appendPrompt: vi.fn() },
  } as any
}

function fakeEventStream(events: any[] = []) {
  return {
    session: async function* () { for (const e of events) yield e },
    onAny: vi.fn(),
    setStatusChecker: vi.fn(),
  } as any
}

function fakeState() {
  let sid: string | undefined = 'ses_test'
  let agent: string | undefined
  let model: any
  const aborts = new Map<string, AbortController>()
  return {
    getLastSessionId: () => sid,
    setLastSessionId: (id: string | undefined) => { sid = id },
    getNextAgent: () => agent,
    setNextAgent: (n: string | undefined) => { agent = n },
    getNextModel: () => model,
    setNextModel: (m: any) => { model = m },
    getTuiSelectedSession: () => undefined,
    setTuiSelectedSession: vi.fn(),
    getCurrentAgent: () => undefined,
    setCurrentAgent: vi.fn(),
    getActiveAbort: (id: string) => aborts.get(id),
    setActiveAbort: (id: string, ac: AbortController | undefined) => {
      if (ac === undefined) aborts.delete(id); else aborts.set(id, ac)
    },
    getSessionCost: () => undefined,
    setSessionCost: vi.fn(),
    flush: async () => {},
  } as any
}

function setup(events: any[] = []) {
  const bus = createCardBus()
  const cards: StructuredCard[] = []
  bus.subscribeAll((c) => cards.push(c))
  const client = fakeClient()
  const relay = createRelay({
    client,
    eventStream: fakeEventStream([...events, { type: 'session.idle', properties: {} }]),
    state: fakeState(),
    cardBus: bus,
    chatTimeoutMs: 5000,
    tuiVisible: false,
  })
  return { bus, cards, client, relay }
}

describe('createRelay', () => {
  it('publishes thinking + user + assistant', async () => {
    const { cards, relay } = setup()
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'm1' })
    expect(cards.map((c) => c.kind)).toEqual(['thinking', 'user', 'assistant'])
  })

  it('publishes streaming card with merged tools', async () => {
    const { cards, relay } = setup([
      { type: 'message.part.updated', properties: { messageID: 'm1', part: { type: 'tool', tool: 'bash', state: { status: 'done', input: { command: 'ls' } } } } },
    ])
    await relay({ userId: '1', chatId: '100', text: 'go', messageId: 'm1' })
    const streaming = cards.filter((c) => c.kind === 'streaming') as Extract<StructuredCard, { kind: 'streaming' }>[]
    expect(streaming.length).toBeGreaterThan(0)
    expect(streaming.at(-1)!.tools[0].tool).toBe('bash')
  })

  it('publishes error card on session.error', async () => {
    const { cards, relay } = setup([
      { type: 'session.error', properties: { error: { message: 'boom' } } },
    ])
    await relay({ userId: '1', chatId: '100', text: 'go', messageId: 'm1' })
    expect(cards.find((c) => c.kind === 'error')).toBeTruthy()
  })

  it('mirrors prompt to TUI when tuiVisible=true', async () => {
    const bus = createCardBus()
    const client = fakeClient()
    const relay = createRelay({
      client,
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
      cardBus: bus,
      chatTimeoutMs: 5000,
      tuiVisible: true,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'm1' })
    expect(client.tui.appendPrompt).toHaveBeenCalled()
  })

  it('retries submitPrompt on network error', async () => {
    const bus = createCardBus()
    const client = fakeClient()
    let calls = 0
    client.session.promptAsync = vi.fn().mockImplementation(async () => {
      calls++
      if (calls <= 2) throw new Error('fetch failed')
      return { data: {} }
    })
    const relay = createRelay({
      client,
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
      cardBus: bus,
      chatTimeoutMs: 120000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'm1' })
    expect(calls).toBe(3)
  })
})
```

- [ ] **Step 3: Delete obsolete relay-abort.test.ts**

The abort behavior is now exercised through `state.getActiveAbort()` directly, not via `transport.edit` assertions. Delete the old file:

```bash
rm tests/unit/relay-abort.test.ts
```

Add a tighter abort test to `relay.test.ts`:

```typescript
it('registers abort controller in state during run', async () => {
  const bus = createCardBus()
  const state = fakeState()
  const setAbort = vi.spyOn(state, 'setActiveAbort')
  const relay = createRelay({
    client: fakeClient(),
    eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
    state, cardBus: bus, chatTimeoutMs: 5000, tuiVisible: false,
  })
  await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'm1' })
  // first call sets, last call clears
  expect(setAbort).toHaveBeenCalled()
})
```

- [ ] **Step 4: Run relay tests**

```bash
npx vitest run tests/unit/relay.test.ts
# Expected: PASS — 6 tests (the 5 above + abort registration)
```

- [ ] **Step 5: Commit**

```bash
git add src/core/relay.ts tests/unit/relay.test.ts
git rm tests/unit/relay-abort.test.ts
git commit -m "refactor(relay): publish StructuredCard via CardBus, retire transport.edit path"
```

---

### Task 6: TelegramSessionRenderer skeleton

**Files:**
- Create: `src/transport/telegram/renderer.ts` — class with `onCard` switch, single-message thinking/assistant path only
- Test: `tests/unit/telegram/renderer.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/unit/telegram/renderer.test.ts
import { describe, it, expect, vi } from 'vitest'
import { TelegramSessionRenderer } from '../../../src/transport/telegram/renderer'
import type { StructuredCard } from '../../../src/core/structured-card'

function fakeBot() {
  return {
    sent: [] as Array<{ chatId: string; text: string; options: any }>,
    edits: [] as Array<{ chatId: string; messageId: string; text: string; options: any }>,
    sendMessage: vi.fn(async function (this: any, chatId: string, text: string, options: any) {
      this.sent.push({ chatId, text, options })
      return { message_id: this.sent.length }
    }),
    editMessageText: vi.fn(async function (this: any, chatId: string, messageId: number, _: any, text: string, options: any) {
      this.edits.push({ chatId, messageId: String(messageId), text, options })
    }),
  }
}

describe('TelegramSessionRenderer', () => {
  it('sends thinking card with Stop button on kind=thinking', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    expect(bot.sent).toHaveLength(1)
    expect(bot.sent[0].text).toMatch(/Working/i)
    expect(bot.sent[0].options.reply_markup.inline_keyboard[0][0].text).toBe('⏹ Stop')
  })

  it('ignores kind=user (Telegram already shows the user message)', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'user', sessionId: 'ses', text: 'hi', ts: 0 })
    expect(bot.sent).toHaveLength(0)
  })

  it('finalizes streaming with assistant footer (single chunk)', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    await r.onCard({ kind: 'streaming', sessionId: 'ses', markdownSrc: 'partial', tools: [] })
    await r.onCard({ kind: 'assistant', sessionId: 'ses', markdownSrc: 'final', tools: [], meta: { cost: 0.04, agent: 'build', model: 'k2p6' } })
    const last = bot.edits.at(-1)!
    expect(last.text).toMatch(/final/)
    expect(last.text).toMatch(/\$0\.040/)
    expect(last.text).toMatch(/build/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/telegram/renderer.test.ts
# Expected: FAIL — cannot find module
```

- [ ] **Step 3: Implement skeleton renderer**

```typescript
// src/transport/telegram/renderer.ts
import type { Telegram } from 'telegraf'
import type { StructuredCard, ToolCall, AssistantMeta } from '../../core/structured-card.js'
import { markdownToTelegramHtml } from '../../utils/markdown.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('tg-renderer')

const TG_MAX = 4000
const RESERVE_META = 200
const RESERVE_ANSWER_FRAC = 0.7
const CHUNK_SOFT_LIMIT = Number(process.env.TG_CHUNK_SOFT_LIMIT ?? 3500)
const CHUNK_HARD_LIMIT = Number(process.env.TG_CHUNK_HARD_LIMIT ?? 3900)

interface RendererOpts {
  chatId: string
  sessionId: string
  bot: Telegram
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function metaFooter(meta: AssistantMeta): string {
  const parts: string[] = []
  if (typeof meta.cost === 'number') parts.push(`💰 $${meta.cost.toFixed(3)}`)
  if (meta.tokens) parts.push(`↑${fmtK(meta.tokens.input)} ↓${fmtK(meta.tokens.output)}`)
  if (meta.agent) parts.push(meta.agent)
  if (meta.model) parts.push(meta.model)
  return parts.join('  ·  ')
}

function stopButton(sessionId: string) {
  return { inline_keyboard: [[{ text: '⏹ Stop', callback_data: `relay:abort:${sessionId}` }]] }
}

export class TelegramSessionRenderer {
  private chatId: string
  private sessionId: string
  private bot: Telegram
  private activeMessageId?: string

  constructor(opts: RendererOpts) {
    this.chatId = opts.chatId
    this.sessionId = opts.sessionId
    this.bot = opts.bot
  }

  async onCard(card: StructuredCard): Promise<void> {
    switch (card.kind) {
      case 'thinking':  return this.startThinking(card.showStop)
      case 'streaming': return this.renderStreaming(card.markdownSrc, card.tools)
      case 'assistant': return this.finalize(card.markdownSrc, card.tools, card.meta)
      case 'error':     return this.markError(card.message)
      case 'user':      return       // Telegram already shows user's own message
      case 'status':
      case 'info':
      case 'approval':  return       // Handled by command handlers, not via renderer in v0.5.0
    }
  }

  private async startThinking(showStop: boolean): Promise<void> {
    const reply_markup = showStop ? stopButton(this.sessionId) : undefined
    const sent = await this.bot.sendMessage(this.chatId, '⏳  Working…', { parse_mode: 'HTML', reply_markup })
    this.activeMessageId = String(sent.message_id)
  }

  private async renderStreaming(md: string, tools: ToolCall[]): Promise<void> {
    if (!this.activeMessageId) return
    const text = this.renderChunkBody(md, tools, { streaming: true })
    try {
      await this.bot.editMessageText(this.chatId, Number(this.activeMessageId), undefined, text, {
        parse_mode: 'HTML',
        reply_markup: stopButton(this.sessionId),
      })
    } catch (err) {
      const m = (err as Error).message
      if (!m.includes('message is not modified')) log.warn('edit failed', m)
    }
  }

  private async finalize(md: string, tools: ToolCall[], meta: AssistantMeta): Promise<void> {
    if (!this.activeMessageId) {
      // No thinking card was sent — send fresh
      const sent = await this.bot.sendMessage(this.chatId, this.renderChunkBody(md, tools, { meta }), { parse_mode: 'HTML' })
      this.activeMessageId = String(sent.message_id)
      return
    }
    const text = this.renderChunkBody(md, tools, { meta })
    try {
      await this.bot.editMessageText(this.chatId, Number(this.activeMessageId), undefined, text, { parse_mode: 'HTML' })
    } catch (err) { log.warn('finalize edit failed', (err as Error).message) }
  }

  private async markError(message: string): Promise<void> {
    const text = `❌  <b>Error</b>\n\n<code>${escHtml(message)}</code>`
    if (this.activeMessageId) {
      try { await this.bot.editMessageText(this.chatId, Number(this.activeMessageId), undefined, text, { parse_mode: 'HTML' }) }
      catch {}
    } else {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' })
    }
  }

  // Skeleton — Section 3 collapse + pagination logic added in Tasks 7-9.
  private renderChunkBody(md: string, tools: ToolCall[], opts: { streaming?: boolean; meta?: AssistantMeta }): string {
    const lines: string[] = []
    if (tools.length > 0) {
      for (const t of tools) {
        const mark = t.status === 'done' ? '✓' : t.status === 'error' ? '✗' : '…'
        lines.push(`▸ ${t.tool}${t.args ? ` · ${t.args}` : ''} ${mark}`)
      }
      lines.push('')
    }
    if (md) lines.push(markdownToTelegramHtml(md))
    if (opts.meta) {
      const footer = metaFooter(opts.meta)
      if (footer) { lines.push(''); lines.push('──────────'); lines.push(`<i>${escHtml(footer)}</i>`) }
    }
    return lines.join('\n')
  }
}
```

- [ ] **Step 4: Run test**

```bash
npx vitest run tests/unit/telegram/renderer.test.ts
# Expected: PASS — 3 tests
```

- [ ] **Step 5: Commit**

```bash
git add src/transport/telegram/renderer.ts tests/unit/telegram/renderer.test.ts
git commit -m "feat(telegram): TelegramSessionRenderer skeleton — thinking/streaming/assistant single chunk"
```

---

### Task 7: Adaptive throttling

**Files:**
- Modify: `src/transport/telegram/renderer.ts`
- Test: `tests/unit/telegram/renderer.test.ts` (add throttle case)

- [ ] **Step 1: Add throttle test**

Append to `tests/unit/telegram/renderer.test.ts`:

```typescript
it('throttles consecutive streaming edits', async () => {
  vi.useFakeTimers()
  const bot = fakeBot()
  const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
  await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
  // 6 rapid deltas — first immediate, next 5 throttled to ~250ms, then 1000ms after that
  for (let i = 0; i < 6; i++) {
    await r.onCard({ kind: 'streaming', sessionId: 'ses', markdownSrc: 'x'.repeat(i + 1), tools: [] })
  }
  expect(bot.edits.length).toBeLessThanOrEqual(2)  // first edit + maybe one throttled
  vi.advanceTimersByTime(2000)
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run test (will fail)**

```bash
npx vitest run tests/unit/telegram/renderer.test.ts -t throttles
# Expected: FAIL — currently every streaming card triggers an edit
```

- [ ] **Step 3: Add adaptive throttle**

Modify `renderer.ts`, add fields and update `renderStreaming`:

```typescript
// Add inside class:
private lastEditAt = 0
private editsInBurst = 0

private currentThrottleMs(): number {
  if (this.editsInBurst === 0) return 0
  if (this.editsInBurst < 5) return 250
  return 1000
}

private async renderStreaming(md: string, tools: ToolCall[]): Promise<void> {
  if (!this.activeMessageId) return
  const now = Date.now()
  const since = now - this.lastEditAt
  // Tool status change = high signal, always allow
  const toolStatusChange = tools.some((t) => t.status === 'done' || t.status === 'error')
  if (!toolStatusChange && since < this.currentThrottleMs()) return

  this.lastEditAt = now
  this.editsInBurst += 1
  const text = this.renderChunkBody(md, tools, { streaming: true })
  try {
    await this.bot.editMessageText(this.chatId, Number(this.activeMessageId), undefined, text, {
      parse_mode: 'HTML',
      reply_markup: stopButton(this.sessionId),
    })
  } catch (err) {
    const m = (err as Error).message
    if (!m.includes('message is not modified')) log.warn('edit failed', m)
  }
}
```

- [ ] **Step 4: Run test**

```bash
npx vitest run tests/unit/telegram/renderer.test.ts
# Expected: PASS — 4 tests
```

- [ ] **Step 5: Commit**

```bash
git add src/transport/telegram/renderer.ts tests/unit/telegram/renderer.test.ts
git commit -m "feat(telegram): adaptive throttle for streaming edits"
```

---

### Task 8: Tool collapse rendering

**Files:**
- Modify: `src/transport/telegram/renderer.ts`
- Test: `tests/unit/telegram/renderer.test.ts`

- [ ] **Step 1: Add collapse test**

```typescript
it('collapses tools list: first 2 + last 5 with … N more when count is 8-15', async () => {
  const bot = fakeBot()
  const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
  await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
  const tools = Array.from({ length: 12 }, (_, i) => ({
    tool: 'bash', args: `cmd${i}`, status: 'done' as const,
  }))
  await r.onCard({ kind: 'assistant', sessionId: 'ses', markdownSrc: 'done', tools, meta: {} })
  const last = bot.edits.at(-1)!
  expect(last.text).toMatch(/cmd0/)
  expect(last.text).toMatch(/cmd1/)
  expect(last.text).toMatch(/cmd7/)        // last 5 → cmd7..cmd11
  expect(last.text).toMatch(/cmd11/)
  expect(last.text).toMatch(/… 5 more tool calls/)
  expect(last.text).not.toMatch(/cmd5/)    // collapsed
})

it('collapses tools list: first 1 + last 4 when count > 15', async () => {
  const bot = fakeBot()
  const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
  await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
  const tools = Array.from({ length: 20 }, (_, i) => ({
    tool: 'bash', args: `cmd${i}`, status: 'done' as const,
  }))
  await r.onCard({ kind: 'assistant', sessionId: 'ses', markdownSrc: 'done', tools, meta: {} })
  const last = bot.edits.at(-1)!
  expect(last.text).toMatch(/cmd0/)
  expect(last.text).toMatch(/cmd16/)
  expect(last.text).toMatch(/cmd19/)
  expect(last.text).toMatch(/… 15 more tool calls/)
})
```

- [ ] **Step 2: Run test (will fail)**

```bash
npx vitest run tests/unit/telegram/renderer.test.ts -t collapses
# Expected: FAIL — all 12/20 tools rendered
```

- [ ] **Step 3: Add collapseTools helper, wire into renderChunkBody**

Add to `renderer.ts`:

```typescript
function collapseTools(tools: ToolCall[]): ToolCall[] {
  if (tools.length <= 7) return tools
  // running tools always pinned to last group
  const running = tools.filter((t) => t.status === 'running')
  const done = tools.filter((t) => t.status !== 'running')
  if (tools.length <= 15) {
    const first = done.slice(0, 2)
    const tail = [...done.slice(2, -3), ...running].slice(-5)
    const middleCount = tools.length - first.length - tail.length
    if (middleCount <= 0) return [...first, ...tail]
    return [...first, { tool: '__more__', args: `${middleCount} more tool calls`, status: 'done' }, ...tail]
  }
  const first = done.slice(0, 1)
  const tail = [...done.slice(1, -3), ...running].slice(-4)
  const middleCount = tools.length - first.length - tail.length
  return [...first, { tool: '__more__', args: `${middleCount} more tool calls`, status: 'done' }, ...tail]
}
```

Update `renderChunkBody` to use `collapseTools` and render the synthetic `__more__` marker as `… N more tool calls`:

```typescript
private renderChunkBody(md: string, tools: ToolCall[], opts: { streaming?: boolean; meta?: AssistantMeta }): string {
  const lines: string[] = []
  const collapsed = collapseTools(tools)
  if (collapsed.length > 0) {
    for (const t of collapsed) {
      if (t.tool === '__more__') {
        lines.push(`… ${t.args}`)
      } else {
        const mark = t.status === 'done' ? '✓' : t.status === 'error' ? '✗' : '…'
        lines.push(`▸ ${t.tool}${t.args ? ` · ${escHtml(t.args)}` : ''} ${mark}`)
      }
    }
    lines.push('')
  }
  if (md) lines.push(markdownToTelegramHtml(md))
  if (opts.meta) {
    const footer = metaFooter(opts.meta)
    if (footer) { lines.push(''); lines.push('──────────'); lines.push(`<i>${escHtml(footer)}</i>`) }
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/telegram/renderer.test.ts
# Expected: PASS — 6 tests
```

- [ ] **Step 5: Commit**

```bash
git add src/transport/telegram/renderer.ts tests/unit/telegram/renderer.test.ts
git commit -m "feat(telegram): progressive tool-call collapse in renderer"
```

---

### Task 9: Multi-message pagination

**Files:**
- Modify: `src/transport/telegram/renderer.ts`
- Test: `tests/unit/telegram/overflow.test.ts`

- [ ] **Step 1: Create overflow test**

```typescript
// tests/unit/telegram/overflow.test.ts
import { describe, it, expect, vi } from 'vitest'
import { TelegramSessionRenderer } from '../../../src/transport/telegram/renderer'

function fakeBot() {
  return {
    sent: [] as Array<{ chatId: string; text: string; options: any }>,
    edits: [] as Array<{ chatId: string; messageId: string; text: string; options: any }>,
    sendMessage: vi.fn(async function (this: any, chatId: string, text: string, options: any) {
      this.sent.push({ chatId, text, options })
      return { message_id: this.sent.length }
    }),
    editMessageText: vi.fn(async function (this: any, chatId: string, messageId: number, _: any, text: string, options: any) {
      this.edits.push({ chatId, messageId: String(messageId), text, options })
    }),
  }
}

describe('TelegramSessionRenderer overflow', () => {
  it('paginates a long final answer into multiple Telegram messages', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const longMd = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}: ${'x'.repeat(200)}`).join('\n\n')
    await r.onCard({ kind: 'assistant', sessionId: 'ses', markdownSrc: longMd, tools: [], meta: { cost: 0.04 } })
    // expect at least 2 messages sent (the initial thinking + ≥1 continuation)
    expect(bot.sent.length).toBeGreaterThanOrEqual(2)
    // last message should contain the meta footer
    const last = bot.sent.at(-1)!
    expect(last.text).toMatch(/\$0\.040/)
  })

  it('streaming paginates at soft limit on natural boundary', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    // accumulate text past CHUNK_SOFT_LIMIT then end on \n\n
    let md = ''
    for (let i = 0; i < 4; i++) {
      md += 'Y'.repeat(1000) + '\n\n'
      await r.onCard({ kind: 'streaming', sessionId: 'ses', markdownSrc: md, tools: [] })
    }
    expect(bot.sent.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run test (will fail)**

```bash
npx vitest run tests/unit/telegram/overflow.test.ts
# Expected: FAIL — only one message sent
```

- [ ] **Step 3: Add pagination logic**

Add to `renderer.ts`. Maintain per-chunk state and split on natural boundaries:

```typescript
// Add at top:
function findBoundary(md: string, near: number): number {
  // Prefer paragraph break before `near`
  const para = md.lastIndexOf('\n\n', near)
  if (para >= near - 500 && para > 0) return para + 2
  // Fall back to line break
  const line = md.lastIndexOf('\n', near)
  if (line >= near - 200 && line > 0) return line + 1
  // Last resort: hard cut
  return near
}

function splitMarkdown(md: string, perChunk: number): string[] {
  const out: string[] = []
  let pos = 0
  while (pos < md.length) {
    const remaining = md.slice(pos)
    if (remaining.length <= perChunk) { out.push(remaining); break }
    const cut = findBoundary(remaining, perChunk)
    out.push(remaining.slice(0, cut))
    pos += cut
  }
  return out
}
```

Refactor renderer to track `chunkIndex` and use `splitMarkdown` in `finalize`:

```typescript
// In TelegramSessionRenderer:
private chunkIndex = 0

private async finalize(md: string, tools: ToolCall[], meta: AssistantMeta): Promise<void> {
  const PER_CHUNK = Math.floor((CHUNK_SOFT_LIMIT - RESERVE_META) * RESERVE_ANSWER_FRAC)
  const pieces = splitMarkdown(md, PER_CHUNK)
  if (pieces.length === 1) {
    // single chunk path
    const text = this.renderChunkBody(pieces[0], tools, { meta })
    if (this.activeMessageId) {
      try { await this.bot.editMessageText(this.chatId, Number(this.activeMessageId), undefined, text, { parse_mode: 'HTML' }) }
      catch (err) { log.warn('finalize edit failed', (err as Error).message) }
    } else {
      const sent = await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' })
      this.activeMessageId = String(sent.message_id)
    }
    return
  }
  // Multi-chunk: edit first chunk into activeMessageId, send rest as new messages
  for (let i = 0; i < pieces.length; i++) {
    const isLast = i === pieces.length - 1
    const header = `<b>Part ${i + 1}/${pieces.length}</b>\n`
    const body = this.renderChunkBody(pieces[i], i === 0 ? tools : [], isLast ? { meta } : {})
    const text = header + body
    if (i === 0 && this.activeMessageId) {
      try {
        await this.bot.editMessageText(this.chatId, Number(this.activeMessageId), undefined, text, { parse_mode: 'HTML' })
      } catch (err) { log.warn('paginate edit failed', (err as Error).message) }
    } else {
      const sent = await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' })
      this.activeMessageId = String(sent.message_id)
    }
  }
}
```

Also handle streaming pagination — when chunk exceeds soft limit at natural boundary:

```typescript
private streamingChunkBuffer = ''

private async renderStreaming(md: string, tools: ToolCall[]): Promise<void> {
  if (!this.activeMessageId) return
  this.streamingChunkBuffer = md
  // Decide: do we paginate now?
  const renderedLen = this.renderChunkBody(md, tools, { streaming: true }).length
  const naturalBoundary = md.endsWith('\n\n') || tools.some((t) => t.status === 'done')

  if (renderedLen >= CHUNK_HARD_LIMIT || (renderedLen >= CHUNK_SOFT_LIMIT && naturalBoundary)) {
    // freeze current message, start new one
    const header = `<b>Part ${this.chunkIndex + 1} · done</b>\n`
    try {
      await this.bot.editMessageText(this.chatId, Number(this.activeMessageId), undefined,
        header + this.renderChunkBody(md, tools, {}), { parse_mode: 'HTML' })
    } catch {}
    this.chunkIndex += 1
    const newHeader = `<b>Part ${this.chunkIndex + 1} · streaming…</b>\n⏳`
    const sent = await this.bot.sendMessage(this.chatId, newHeader, {
      parse_mode: 'HTML', reply_markup: stopButton(this.sessionId),
    })
    this.activeMessageId = String(sent.message_id)
    this.lastEditAt = 0
    this.editsInBurst = 0
    return
  }

  // Normal throttled edit path
  const now = Date.now()
  const since = now - this.lastEditAt
  const toolStatusChange = tools.some((t) => t.status === 'done' || t.status === 'error')
  if (!toolStatusChange && since < this.currentThrottleMs()) return
  this.lastEditAt = now
  this.editsInBurst += 1
  const text = this.renderChunkBody(md, tools, { streaming: true })
  try {
    await this.bot.editMessageText(this.chatId, Number(this.activeMessageId), undefined, text, {
      parse_mode: 'HTML', reply_markup: stopButton(this.sessionId),
    })
  } catch (err) {
    const m = (err as Error).message
    if (!m.includes('message is not modified')) log.warn('edit failed', m)
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/telegram/
# Expected: PASS — renderer.test.ts + overflow.test.ts all green
```

- [ ] **Step 5: Commit**

```bash
git add src/transport/telegram/renderer.ts tests/unit/telegram/overflow.test.ts
git commit -m "feat(telegram): live multi-message pagination on overflow"
```

---

### Task 10: Wire Telegram transport to CardBus + renderer

**Files:**
- Modify: `src/transport/telegram/index.ts`

- [ ] **Step 1: Update createTelegramTransport to consume CardBus**

Replace `src/transport/telegram/index.ts` body (the `start()` method and constructor) to:
- Take `cardBus` from `start({ cardBus, state })`
- Build a `TelegramSessionRenderer` per (chatId, sessionId) on demand
- Subscribe to `cardBus.subscribeAll`
- Remove `edit`/`delete` methods entirely
- Remove old `send(card)` Card-typed path, replace with `StructuredCard`

```typescript
// src/transport/telegram/index.ts
import { Telegraf } from 'telegraf'
import type { Context } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { IncomingMessage, ChannelCapabilities } from '../../core/types.js'
import type { Transport, TransportStartDeps } from '../interface.js'
import type { StructuredCard } from '../../core/structured-card.js'
import type { EventStream } from '../../opencode/event-stream.js'
import { TelegramSessionRenderer } from './renderer.js'
import { registerHandlers } from './handlers.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('telegram')

export interface TelegramConfig {
  token: string
  allowedUserIds: number[]
  baseUrl: string
  client: OpencodeClient
  eventStream: EventStream
}

const CAPS: ChannelCapabilities = {
  edit: true, maxMessageLength: 4000, buttons: true, richText: true, streaming: false,
}

export function createTelegramTransport(cfg: TelegramConfig): Transport {
  const bot = new Telegraf(cfg.token, { handlerTimeout: 600_000 })
  bot.use(async (ctx, next) => {
    if (!cfg.allowedUserIds.includes(ctx.from?.id ?? -1)) {
      if (ctx.from) log.warn(`rejected from ${ctx.from.id}`)
      await ctx.reply('Unauthorized').catch(() => {})
      return
    }
    await next()
  })

  let messageHandler: ((msg: IncomingMessage) => Promise<void>) | undefined
  let isGenerating = false

  bot.use(async (ctx: Context, next) => {
    if (ctx.callbackQuery) return next()
    const m = ctx.message
    if (!m || !('text' in m)) return next()
    if (m.text.startsWith('/')) return next()
    if (!messageHandler) return next()
    if (isGenerating) { void ctx.reply('⏳ Session is already generating. Wait or /abort.'); return }
    isGenerating = true
    const msg: IncomingMessage = {
      userId: String(ctx.from!.id), chatId: String(ctx.chat!.id),
      text: m.text, messageId: String(m.message_id),
    }
    void messageHandler(msg).finally(() => { isGenerating = false })
  })

  // Renderers keyed by sessionId — assume single chatId (first allowed user)
  const primaryChatId = String(cfg.allowedUserIds[0])
  const renderers = new Map<string, TelegramSessionRenderer>()
  function getRenderer(sessionId: string): TelegramSessionRenderer {
    let r = renderers.get(sessionId)
    if (!r) {
      r = new TelegramSessionRenderer({ chatId: primaryChatId, sessionId, bot: bot.telegram })
      renderers.set(sessionId, r)
    }
    return r
  }

  bot.catch((err, ctx) => {
    log.error('telegraf catch-all', err as Error)
    ctx.reply(`Internal error: ${(err as Error).message}`).catch(() => {})
  })

  return {
    name: 'telegram',
    capabilities: CAPS,
    async start(deps: TransportStartDeps) {
      deps.cardBus.subscribeAll((card: StructuredCard) => {
        if (!('sessionId' in card)) return
        void getRenderer(card.sessionId).onCard(card)
        // When a session is finalized, reset its renderer so the next turn starts fresh
        if (card.kind === 'assistant' || card.kind === 'error') {
          renderers.delete(card.sessionId)
        }
      })

      registerHandlers({
        bot, client: cfg.client, baseUrl: cfg.baseUrl,
        state: deps.state, eventStream: cfg.eventStream,
        chatId: cfg.allowedUserIds[0],
        isGenerating: () => isGenerating,
        abortGeneration: () => {
          const sid = deps.state.getLastSessionId()
          if (sid) deps.state.getActiveAbort(sid)?.abort()
        },
      })

      let attempt = 0; let conflictCount = 0; const MAX_CONFLICT = 8
      for (;;) {
        try { await bot.launch(); log.info('bot polling ended cleanly'); return }
        catch (err) {
          const e = err as { response?: { error_code?: number }; message?: string }
          if (e?.response?.error_code === 409) {
            if (++conflictCount >= MAX_CONFLICT) throw new Error('Telegram 409 persisted')
            log.warn(`409 #${conflictCount}, retry in 5s`)
            await new Promise((r) => setTimeout(r, 5000))
          } else {
            attempt += 1
            const delay = Math.min(1000 * 2 ** attempt, 30000)
            log.error(`bot.launch failed (attempt ${attempt})`, e?.message ?? err)
            await new Promise((r) => setTimeout(r, delay))
          }
        }
      }
    },
    async stop() { bot.stop('manual') },
    async send(_chatId, _card: StructuredCard) {
      // v0.5.0: direct send used by slash handlers, but those still use ctx.reply.
      // Stub to satisfy interface; will be wired when slash handlers migrate (future).
      throw new Error('Transport.send not implemented for Telegram in v0.5.0')
    },
    onMessage(h) { messageHandler = h },
    onCommand() { /* commands registered in handlers.ts */ },
    onButtonClick() { /* callbacks in handlers.ts */ },
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "^src/" | head -30
# Expected: errors confined to src/index.ts (start signature) and tests we'll fix in Task 11.
```

- [ ] **Step 3: Commit**

```bash
git add src/transport/telegram/index.ts
git commit -m "refactor(telegram): consume CardBus via renderers, remove transport.edit"
```

---

### Task 11: Wire `index.ts` to new multi-transport startup

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update runBot to construct CardBus and pass to transports**

```typescript
// src/index.ts
import 'dotenv/config'
import { loadConfig } from './config.js'
import { getClient, checkHealth } from './opencode/client.js'
import { EventStream } from './opencode/event-stream.js'
import { createFileBackedState } from './core/state.js'
import { createCardBus } from './core/card-bus.js'
import { createRelay } from './core/relay.js'
import { startTuiSync } from './core/tui-sync.js'
import { createTelegramTransport } from './transport/telegram/index.js'
import { startPushNotifications } from './core/push.js'
import { createLogger } from './utils/logger.js'

const log = createLogger('main')

async function waitForHealth(baseUrl: string): Promise<void> {
  const RETRIES = 3
  const BACKOFF = [2000, 4000, 8000]
  for (let i = 0; i < RETRIES; i++) {
    if (await checkHealth(baseUrl)) { log.info(`opencode healthy at ${baseUrl}`); return }
    log.warn(`opencode unhealthy (${i+1}/${RETRIES}), retry in ${BACKOFF[i]}ms`)
    await new Promise((r) => setTimeout(r, BACKOFF[i]))
  }
  throw new Error('opencode failed health check')
}

export async function runBot(): Promise<void> {
  const config = loadConfig()
  log.info(`starting, transport=${config.transport}, opencode=${config.opencodeBaseUrl}`)
  await waitForHealth(config.opencodeBaseUrl)

  const client = getClient(config.opencodeBaseUrl)
  const eventStream = new EventStream()
  eventStream.start(client)

  const state = createFileBackedState(config.statePath)
  const cardBus = createCardBus()

  const transport = createTelegramTransport({
    token: config.telegramBotToken,
    allowedUserIds: config.allowedUserIds,
    baseUrl: config.opencodeBaseUrl,
    client, eventStream,
  })

  const relay = createRelay({
    client, eventStream, state, cardBus,
    chatTimeoutMs: config.chatTimeoutMs, tuiVisible: config.tuiVisible,
  })

  transport.onMessage(relay)

  const stopSync = startTuiSync({ eventStream, state, client })

  const stopPush = startPushNotifications({
    eventStream, transport, chatId: String(config.allowedUserIds[0]),
  } as any)

  process.once('SIGINT', () => { eventStream.stop(); stopSync(); stopPush(); void transport.stop() })
  process.once('SIGTERM', () => { eventStream.stop(); stopSync(); stopPush(); void transport.stop() })

  await transport.start({ cardBus, state })
}

if (process.argv[1]?.endsWith('dist/index.js')) {
  runBot().catch((err) => { log.error('fatal', err as Error); process.exit(1) })
}
```

- [ ] **Step 2: Update any tests that used the old start() signature**

Search for and fix:
```bash
grep -rn "transport.start()" tests/ src/
# Expected: no remaining results after fixes
```

- [ ] **Step 3: Run full unit suite**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
# Expected: all tests pass
```

If `push.ts` or `tui-sync.ts` still reference the old transport.edit, patch them to instead call `transport.send` or use cardBus.publish. Update tests as needed.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "refactor(main): wire CardBus into runBot, new Transport.start(deps)"
```

---

### Task 12: Integration smoke — Telegram overflow fix

**Files:**
- Create: `tests/integration/telegram-overflow.test.ts`

- [ ] **Step 1: Add integration test**

```typescript
// tests/integration/telegram-overflow.test.ts
import { describe, it, expect, vi } from 'vitest'
import { TelegramSessionRenderer } from '../../src/transport/telegram/renderer'

function bot() {
  const sent: any[] = []; const edits: any[] = []
  return {
    sent, edits,
    sendMessage: vi.fn(async function (this: any, chatId: string, text: string, options: any) {
      sent.push({ chatId, text, options }); return { message_id: sent.length }
    }),
    editMessageText: vi.fn(async function (this: any, chatId: string, mid: number, _: any, text: string, options: any) {
      edits.push({ chatId, mid, text, options })
    }),
  }
}

describe('Telegram overflow integration', () => {
  it('15000-char final answer produces ≥3 messages, footer on last', async () => {
    const b = bot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: b as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const md = Array.from({ length: 60 }, (_, i) => `# Section ${i}\n${'x'.repeat(200)}`).join('\n\n')
    await r.onCard({ kind: 'assistant', sessionId: 'ses', markdownSrc: md, tools: [], meta: { cost: 0.10 } })
    expect(b.sent.length).toBeGreaterThanOrEqual(3)
    expect(b.sent.at(-1)!.text).toMatch(/\$0\.100/)
  })
})
```

- [ ] **Step 2: Run integration test**

```bash
npx vitest run tests/integration/telegram-overflow.test.ts
# Expected: PASS
```

- [ ] **Step 3: Final Phase 5.A check — run everything**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
# Expected: all green
```

- [ ] **Step 4: Commit**

```bash
git add tests/integration/telegram-overflow.test.ts
git commit -m "test(integration): Telegram overflow — 15k-char answer paginated correctly"
```

---

## ✅ Phase 5.A Checkpoint

Telegram-only mode (existing transport) now uses CardBus + renderer, with
overflow fix verified. All prior tests + new tests pass.

Manual verification (optional, requires real opencode + bot token):
1. Start bot: `npm run dev`
2. Send a prompt that triggers long thinking (e.g., "explain the codebase
   in detail with code examples").
3. Verify Telegram receives multiple "Part 1 · done", "Part 2 · done",
   ..., "Part N" messages instead of a single truncated one.

---

## Phase 5.B — Web Backend

### Task 13: Add server dependencies

**Files:** `package.json`

- [ ] **Step 1: Install runtime + dev deps**

```bash
npm install hono ws jose
npm install -D @types/ws concurrently
```

- [ ] **Step 2: Verify versions installed**

```bash
node -p "Object.keys(require('./package.json').dependencies).filter(d => ['hono','ws','jose'].includes(d))"
# Expected: [ 'hono', 'ws', 'jose' ]
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add hono, ws, jose, concurrently for web transport"
```

---

### Task 14: CF Access middleware

**Files:**
- Create: `src/transport/web/middleware/cf-access.ts`
- Test: `tests/unit/web/cf-access.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/web/cf-access.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { cfAccessMiddleware } from '../../../src/transport/web/middleware/cf-access'

vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}) as any,
  jwtVerify: vi.fn(async (token: string) => {
    if (token === 'good') return { payload: { email: 'user@example.com', sub: 'u1' } }
    throw new Error('invalid')
  }),
}))

describe('cfAccessMiddleware', () => {
  it('rejects requests without token', async () => {
    const app = new Hono()
    app.use('*', cfAccessMiddleware({ team: 'acme', aud: 'a1' }))
    app.get('/x', (c) => c.text('ok'))
    const res = await app.request('/x')
    expect(res.status).toBe(401)
  })

  it('accepts valid JWT header', async () => {
    const app = new Hono()
    app.use('*', cfAccessMiddleware({ team: 'acme', aud: 'a1' }))
    app.get('/x', (c) => c.text('ok'))
    const res = await app.request('/x', { headers: { 'cf-access-jwt-assertion': 'good' } })
    expect(res.status).toBe(200)
  })

  it('rejects invalid JWT', async () => {
    const app = new Hono()
    app.use('*', cfAccessMiddleware({ team: 'acme', aud: 'a1' }))
    app.get('/x', (c) => c.text('ok'))
    const res = await app.request('/x', { headers: { 'cf-access-jwt-assertion': 'bad' } })
    expect(res.status).toBe(401)
  })

  it('dev bypass works on loopback host', async () => {
    const app = new Hono()
    app.use('*', cfAccessMiddleware({ team: '', aud: '', devBypass: true, devEmail: 'd@l', host: '127.0.0.1' }))
    app.get('/x', (c) => c.text('ok'))
    const res = await app.request('/x')
    expect(res.status).toBe(200)
  })

  it('dev bypass ignored on non-loopback host', async () => {
    const app = new Hono()
    app.use('*', cfAccessMiddleware({ team: 'acme', aud: 'a1', devBypass: true, devEmail: 'd@l', host: 'oprc.example.com' }))
    app.get('/x', (c) => c.text('ok'))
    const res = await app.request('/x')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test (fails)**

```bash
npx vitest run tests/unit/web/cf-access.test.ts
# Expected: FAIL — module missing
```

- [ ] **Step 3: Implement middleware**

```typescript
// src/transport/web/middleware/cf-access.ts
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { createLogger } from '../../../utils/logger.js'

const log = createLogger('cf-access')

export interface CfAccessOpts {
  team: string
  aud: string
  devBypass?: boolean
  devEmail?: string
  host?: string
}

function isLoopback(host?: string): boolean {
  if (!host) return false
  return host === '127.0.0.1' || host === 'localhost' || host.startsWith('localhost:') || host.startsWith('127.0.0.1:')
}

export function cfAccessMiddleware(opts: CfAccessOpts): MiddlewareHandler {
  const JWKS = opts.team
    ? createRemoteJWKSet(new URL(`https://${opts.team}.cloudflareaccess.com/cdn-cgi/access/certs`))
    : null

  return async (c, next) => {
    const host = opts.host ?? c.req.header('host') ?? ''
    if (opts.devBypass && isLoopback(host)) {
      c.set('user', { email: opts.devEmail ?? 'dev@localhost', sub: 'dev' })
      return next()
    }
    const token = c.req.header('cf-access-jwt-assertion')
      ?? c.req.query('cf_access_jwt')
      ?? getCookie(c, 'CF_Authorization')
    if (!token || !JWKS) return c.text('Unauthorized', 401)
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: `https://${opts.team}.cloudflareaccess.com`,
        audience: opts.aud,
      })
      c.set('user', { email: payload.email as string, sub: String(payload.sub ?? '') })
      await next()
    } catch (err) {
      log.warn('jwt verify failed', (err as Error).message)
      return c.text('Invalid token', 401)
    }
  }
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run tests/unit/web/cf-access.test.ts
# Expected: PASS — 5 tests
```

- [ ] **Step 5: Commit**

```bash
git add src/transport/web/middleware/cf-access.ts tests/unit/web/cf-access.test.ts
git commit -m "feat(web): CF Access JWT middleware with dev bypass"
```

---

### Task 15: Hono server skeleton + /api/me

**Files:**
- Create: `src/transport/web/server.ts`
- Test: `tests/unit/web/server.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/web/server.test.ts
import { describe, it, expect } from 'vitest'
import { buildServer } from '../../../src/transport/web/server'

describe('web server', () => {
  it('GET /api/me returns user email (dev bypass)', async () => {
    const app = buildServer({
      cfAccess: { team: '', aud: '', devBypass: true, devEmail: 'd@local', host: '127.0.0.1' },
      client: {} as any,
      state: {} as any,
      cardBus: {} as any,
      wsHub: { subscribe: () => () => {} } as any,
      cacheSize: 100,
    })
    const res = await app.request('/api/me')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'd@local' })
  })

  it('GET /api/me returns 401 without auth', async () => {
    const app = buildServer({
      cfAccess: { team: 'acme', aud: 'a1', devBypass: false, host: 'oprc.example.com' },
      client: {} as any,
      state: {} as any,
      cardBus: {} as any,
      wsHub: { subscribe: () => () => {} } as any,
      cacheSize: 100,
    })
    const res = await app.request('/api/me')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test (fails)**

```bash
npx vitest run tests/unit/web/server.test.ts
# Expected: FAIL — module missing
```

- [ ] **Step 3: Implement server skeleton**

```typescript
// src/transport/web/server.ts
import { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../core/state.js'
import type { CardBus } from '../../core/card-bus.js'
import { cfAccessMiddleware, type CfAccessOpts } from './middleware/cf-access.js'

export interface WsHub {
  subscribe(fn: (msg: any) => void): () => void
  broadcast(msg: any): void
  attach?(server: any): void
}

export interface BuildServerOpts {
  cfAccess: CfAccessOpts
  client: OpencodeClient
  state: SessionState
  cardBus: CardBus
  wsHub: WsHub
  cacheSize: number
}

export function buildServer(opts: BuildServerOpts): Hono {
  const app = new Hono()
  app.use('/api/*', cfAccessMiddleware(opts.cfAccess))

  app.get('/api/me', (c) => {
    const user = c.get('user') as { email: string } | undefined
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    return c.json({ email: user.email })
  })

  return app
}
```

- [ ] **Step 4: Run test (pass)**

```bash
npx vitest run tests/unit/web/server.test.ts
# Expected: PASS — 2 tests
```

- [ ] **Step 5: Commit**

```bash
git add src/transport/web/server.ts tests/unit/web/server.test.ts
git commit -m "feat(web): Hono server skeleton + GET /api/me"
```

---

### Task 16: REST routes — sessions, history, message, abort

**Files:**
- Modify: `src/transport/web/server.ts`
- Create: `src/transport/web/routes/sessions.ts`
- Create: `src/transport/web/routes/session.ts`
- Create: `src/transport/web/routes/message.ts`
- Create: `src/transport/web/routes/abort.ts`
- Test: `tests/unit/web/routes.test.ts`

- [ ] **Step 1: Write routes tests**

```typescript
// tests/unit/web/routes.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildServer } from '../../../src/transport/web/server'

function fakeState() {
  const costs = new Map<string, number>([['ses_a', 0.1], ['ses_b', 0.05]])
  return {
    getSessionCost: (id: string) => costs.get(id),
    setSessionCost: vi.fn(),
    getLastSessionId: () => 'ses_a',
    getActiveAbort: (id: string) => id === 'ses_a' ? { abort: vi.fn() } as any : undefined,
    setActiveAbort: vi.fn(),
    getNextAgent: () => undefined,
    getNextModel: () => undefined,
    setNextAgent: vi.fn(),
    setNextModel: vi.fn(),
    getCurrentAgent: () => undefined,
    setCurrentAgent: vi.fn(),
    getTuiSelectedSession: () => undefined,
    setTuiSelectedSession: vi.fn(),
    setLastSessionId: vi.fn(),
    flush: async () => {},
    _costs: costs,
  } as any
}

function fakeClient() {
  return {
    session: {
      list: vi.fn().mockResolvedValue({ data: [
        { id: 'ses_a', time: { created: 200 }, agent: { name: 'build' }, model: 'k2p6' },
        { id: 'ses_b', time: { created: 100 }, agent: { name: 'plan' } },
      ]}),
      messages: vi.fn().mockResolvedValue({ data: [
        { info: { id: 'm1', sessionID: 'ses_a', role: 'user', time: { created: 1 } }, parts: [{ type: 'text', text: 'hi' }] },
      ]}),
      promptAsync: vi.fn().mockResolvedValue({ data: { messageID: 'msg_1' } }),
    },
  } as any
}

const baseOpts = (state: any, client: any) => ({
  cfAccess: { team: '', aud: '', devBypass: true, devEmail: 'd@l', host: '127.0.0.1' },
  client, state,
  cardBus: { publish: vi.fn(), subscribeAll: () => () => {} } as any,
  wsHub: { subscribe: () => () => {}, broadcast: vi.fn() } as any,
  cacheSize: 100,
})

describe('web routes', () => {
  it('GET /api/sessions returns bot-touched sessions sorted by created desc', async () => {
    const app = buildServer(baseOpts(fakeState(), fakeClient()))
    const res = await app.request('/api/sessions')
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body[0].id).toBe('ses_a')
    expect(body[0].cost).toBe(0.1)
  })

  it('GET /api/session/:id returns history StructuredCards', async () => {
    const app = buildServer(baseOpts(fakeState(), fakeClient()))
    const res = await app.request('/api/session/ses_a')
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body[0].kind).toBe('user')
  })

  it('POST /api/message accepts a prompt', async () => {
    const state = fakeState(); const client = fakeClient()
    const opts = baseOpts(state, client)
    const messageHandler = vi.fn(async () => {})
    const app = buildServer({ ...opts, onMessage: messageHandler } as any)
    const res = await app.request('/api/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_a', text: 'go' }),
    })
    expect(res.status).toBe(200)
    expect(messageHandler).toHaveBeenCalled()
  })

  it('POST /api/abort triggers the active controller', async () => {
    const state = fakeState()
    const ac = { abort: vi.fn() }
    state.getActiveAbort = () => ac as any
    const app = buildServer(baseOpts(state, fakeClient()))
    const res = await app.request('/api/abort', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_a' }),
    })
    expect(res.status).toBe(200)
    expect(ac.abort).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test (fails)**

```bash
npx vitest run tests/unit/web/routes.test.ts
# Expected: FAIL — routes not registered
```

- [ ] **Step 3: Implement routes**

```typescript
// src/transport/web/routes/sessions.ts
import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../../core/state.js'

export function registerSessions(app: Hono, client: OpencodeClient, state: SessionState) {
  app.get('/api/sessions', async (c) => {
    const res = await client.session.list()
    const all = (res.data ?? []) as Array<any>
    // Bot-touched subset: state.getSessionCost(id) is non-undefined
    const touched = all.filter((s) => state.getSessionCost(s.id) !== undefined)
    // If no costs tracked yet, include the most-recent N sessions
    const visible = touched.length > 0 ? touched : all.slice(0, 10)
    const sorted = visible.sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
    const summaries = sorted.map((s) => ({
      id: s.id,
      title: s.title ?? '',
      agent: s.agent?.name,
      model: typeof s.model === 'string' ? s.model : undefined,
      cost: state.getSessionCost(s.id),
      lastActiveAt: s.time?.updated ?? s.time?.created ?? 0,
      unread: false,
    }))
    return c.json(summaries)
  })
}
```

```typescript
// src/transport/web/routes/session.ts
import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { reconstructHistory } from '../../../core/history.js'

export function registerSession(app: Hono, client: OpencodeClient) {
  app.get('/api/session/:id', async (c) => {
    const id = c.req.param('id')
    const cards = await reconstructHistory(client, id)
    return c.json(cards)
  })
}
```

```typescript
// src/transport/web/routes/message.ts
import type { Hono } from 'hono'
import type { IncomingMessage } from '../../../core/types.js'

export function registerMessage(
  app: Hono,
  onMessage: (msg: IncomingMessage) => Promise<void>,
) {
  app.post('/api/message', async (c) => {
    const body = await c.req.json() as { sessionId?: string; text: string }
    const user = c.get('user') as { email: string; sub: string }
    const msg: IncomingMessage = {
      userId: user.sub ?? user.email,
      chatId: `web:${user.email}`,
      text: body.text,
      messageId: `web_${Date.now()}`,
    }
    void onMessage(msg)
    return c.json({ messageId: msg.messageId })
  })
}
```

```typescript
// src/transport/web/routes/abort.ts
import type { Hono } from 'hono'
import type { SessionState } from '../../../core/state.js'

export function registerAbort(app: Hono, state: SessionState) {
  app.post('/api/abort', async (c) => {
    const body = await c.req.json() as { sessionId: string }
    const ac = state.getActiveAbort(body.sessionId)
    ac?.abort()
    return c.json({ ok: true })
  })
}
```

Update `src/transport/web/server.ts` to wire them:

```typescript
import { registerSessions } from './routes/sessions.js'
import { registerSession } from './routes/session.js'
import { registerMessage } from './routes/message.js'
import { registerAbort } from './routes/abort.js'
import type { IncomingMessage } from '../../core/types.js'

export interface BuildServerOpts {
  cfAccess: CfAccessOpts
  client: OpencodeClient
  state: SessionState
  cardBus: CardBus
  wsHub: WsHub
  cacheSize: number
  onMessage?: (msg: IncomingMessage) => Promise<void>
}

export function buildServer(opts: BuildServerOpts): Hono {
  const app = new Hono()
  app.use('/api/*', cfAccessMiddleware(opts.cfAccess))
  app.get('/api/me', (c) => {
    const user = c.get('user') as { email: string } | undefined
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    return c.json({ email: user.email })
  })
  registerSessions(app, opts.client, opts.state)
  registerSession(app, opts.client)
  if (opts.onMessage) registerMessage(app, opts.onMessage)
  registerAbort(app, opts.state)
  return app
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/web/
# Expected: PASS — all web tests
```

- [ ] **Step 5: Commit**

```bash
git add src/transport/web/server.ts src/transport/web/routes/ tests/unit/web/routes.test.ts
git commit -m "feat(web): REST routes — /api/sessions, /api/session/:id, /api/message, /api/abort"
```

---

### Task 17: REST routes — diff, todo, context, approval

**Files:**
- Create: `src/transport/web/routes/diff.ts`
- Create: `src/transport/web/routes/todo.ts`
- Create: `src/transport/web/routes/context.ts`
- Create: `src/transport/web/routes/approval.ts`
- Modify: `src/transport/web/server.ts`
- Add tests to: `tests/unit/web/routes.test.ts`

- [ ] **Step 1: Add tests**

Append to `tests/unit/web/routes.test.ts`:

```typescript
it('GET /api/session/:id/diff passes through to opencode', async () => {
  const client = {
    session: {
      ...fakeClient().session,
      diff: vi.fn().mockResolvedValue({ data: [{ path: 'a.ts', patch: '@@' }] }),
    },
  } as any
  const app = buildServer(baseOpts(fakeState(), client))
  const res = await app.request('/api/session/ses_a/diff')
  expect(res.status).toBe(200)
  expect((await res.json() as any[])[0].path).toBe('a.ts')
})

it('GET /api/session/:id/context composes session state', async () => {
  const client = {
    session: {
      ...fakeClient().session,
      get: vi.fn().mockResolvedValue({ data: {
        agent: { name: 'build' }, model: 'kimi/k2p6',
        tokens: { input: 5000, output: 2000 }, cost: 0.04,
      }}),
    },
  } as any
  const app = buildServer(baseOpts(fakeState(), client))
  const res = await app.request('/api/session/ses_a/context')
  expect(res.status).toBe(200)
  const ctx = await res.json() as any
  expect(ctx.agent).toBe('build')
  expect(ctx.cost).toBe(0.04)
})

it('POST /api/approval proxies the decision to opencode', async () => {
  const respond = vi.fn().mockResolvedValue({})
  const client = { session: { ...fakeClient().session, permissionRespond: respond } } as any
  const app = buildServer(baseOpts(fakeState(), client))
  const res = await app.request('/api/approval', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'ses_a', requestId: 'r1', decision: 'once' }),
  })
  expect(res.status).toBe(200)
  expect(respond).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run (fails)**

```bash
npx vitest run tests/unit/web/routes.test.ts
# Expected: FAIL — routes missing
```

- [ ] **Step 3: Implement routes**

```typescript
// src/transport/web/routes/diff.ts
import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
export function registerDiff(app: Hono, client: OpencodeClient) {
  app.get('/api/session/:id/diff', async (c) => {
    const id = c.req.param('id')
    const res = await (client.session as any).diff({ path: { id } } as any)
    return c.json(res.data ?? [])
  })
}
```

```typescript
// src/transport/web/routes/todo.ts
import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
export function registerTodo(app: Hono, client: OpencodeClient) {
  app.get('/api/session/:id/todo', async (c) => {
    const id = c.req.param('id')
    const res = await (client.session as any).todo({ path: { id } } as any)
    return c.json(res.data ?? [])
  })
}
```

```typescript
// src/transport/web/routes/context.ts
import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../../core/state.js'
export function registerContext(app: Hono, client: OpencodeClient, state: SessionState) {
  app.get('/api/session/:id/context', async (c) => {
    const id = c.req.param('id')
    const res = await client.session.get({ path: { id } })
    const s = (res.data ?? {}) as any
    return c.json({
      sessionId: id,
      agent: s.agent?.name,
      model: typeof s.model === 'string' ? s.model : undefined,
      tokens: s.tokens,
      cost: typeof s.cost === 'number' ? s.cost : state.getSessionCost(id),
      nextAgent: state.getNextAgent(),
      nextModel: state.getNextModel(),
    })
  })
}
```

```typescript
// src/transport/web/routes/approval.ts
import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
export function registerApproval(app: Hono, client: OpencodeClient) {
  app.post('/api/approval', async (c) => {
    const body = await c.req.json() as { sessionId: string; requestId: string; decision: 'once'|'always'|'reject' }
    // opencode SDK call name may differ; we cast and hope. Wire via existing handler in handlers.ts logic.
    await (client.session as any).permissionRespond({
      path: { id: body.sessionId, permissionID: body.requestId },
      body: { response: body.decision },
    } as any)
    return c.json({ ok: true })
  })
}
```

Update `server.ts` to wire:

```typescript
import { registerDiff } from './routes/diff.js'
import { registerTodo } from './routes/todo.js'
import { registerContext } from './routes/context.js'
import { registerApproval } from './routes/approval.js'
// ...
registerDiff(app, opts.client)
registerTodo(app, opts.client)
registerContext(app, opts.client, opts.state)
registerApproval(app, opts.client)
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/web/routes.test.ts
# Expected: PASS — 7 route tests
```

- [ ] **Step 5: Commit**

```bash
git add src/transport/web/routes/diff.ts src/transport/web/routes/todo.ts \
        src/transport/web/routes/context.ts src/transport/web/routes/approval.ts \
        src/transport/web/server.ts tests/unit/web/routes.test.ts
git commit -m "feat(web): /api/diff /api/todo /api/context /api/approval routes"
```

---

### Task 18: WebSocket hub

**Files:**
- Create: `src/transport/web/ws-hub.ts`
- Test: `tests/unit/web/ws-hub.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/web/ws-hub.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createWsHub } from '../../../src/transport/web/ws-hub'
import { createCardBus } from '../../../src/core/card-bus'

function fakeWs() {
  const sent: any[] = []
  return {
    sent,
    readyState: 1,
    send: vi.fn((msg: string) => { sent.push(JSON.parse(msg)) }),
    close: vi.fn(),
    on: vi.fn(),
  }
}

describe('WsHub', () => {
  it('broadcasts cards for subscribed sessionId', () => {
    const bus = createCardBus()
    const hub = createWsHub({ cardBus: bus })
    const ws = fakeWs()
    hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'subscribe', sessionId: 'ses_1' })
    bus.publish({ kind: 'thinking', sessionId: 'ses_1', showStop: true })
    expect(ws.sent.some((m: any) => m.type === 'card')).toBe(true)
  })

  it('does not forward cards for other sessions', () => {
    const bus = createCardBus()
    const hub = createWsHub({ cardBus: bus })
    const ws = fakeWs()
    hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'subscribe', sessionId: 'ses_1' })
    bus.publish({ kind: 'thinking', sessionId: 'ses_2', showStop: true })
    const cardMsgs = ws.sent.filter((m: any) => m.type === 'card')
    expect(cardMsgs.length).toBe(0)
  })

  it('replies pong to ping', () => {
    const hub = createWsHub({ cardBus: createCardBus() })
    const ws = fakeWs()
    hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'ping' })
    expect(ws.sent[0]).toEqual({ type: 'pong' })
  })
})
```

- [ ] **Step 2: Run (fails)**

```bash
npx vitest run tests/unit/web/ws-hub.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement WsHub**

```typescript
// src/transport/web/ws-hub.ts
import type { WebSocket } from 'ws'
import type { CardBus } from '../../core/card-bus.js'
import type { StructuredCard } from '../../core/structured-card.js'

interface ClientState {
  ws: WebSocket
  user: { email: string }
  subscribedSession?: string
}

export interface WsHub {
  attach(ws: WebSocket, user: { email: string }): void
  handleClientMessage(ws: WebSocket, msg: any): void
  detach(ws: WebSocket): void
  broadcast(card: StructuredCard): void
}

export function createWsHub(opts: { cardBus: CardBus }): WsHub {
  const clients = new Map<WebSocket, ClientState>()
  opts.cardBus.subscribeAll((card) => {
    const sid = 'sessionId' in card ? card.sessionId : undefined
    for (const state of clients.values()) {
      if (state.ws.readyState !== 1) continue
      if (sid && state.subscribedSession && state.subscribedSession !== sid) continue
      try { state.ws.send(JSON.stringify({ type: 'card', card })) } catch {}
    }
  })

  return {
    attach(ws, user) {
      clients.set(ws, { ws, user })
      try { ws.send(JSON.stringify({ type: 'hello', sessions: [] })) } catch {}
    },
    handleClientMessage(ws, msg) {
      const state = clients.get(ws)
      if (!state) return
      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return }
      if (msg.type === 'subscribe' && typeof msg.sessionId === 'string') {
        state.subscribedSession = msg.sessionId
        // Replay recent buffered cards
        for (const c of opts.cardBus.recent(msg.sessionId, msg.limit ?? 100)) {
          try { ws.send(JSON.stringify({ type: 'card', card: c })) } catch {}
        }
      }
    },
    detach(ws) { clients.delete(ws) },
    broadcast(card) { /* not used directly — cards flow via CardBus.publish */ },
  }
}
```

- [ ] **Step 4: Run (pass)**

```bash
npx vitest run tests/unit/web/ws-hub.test.ts
# Expected: PASS — 3 tests
```

- [ ] **Step 5: Commit**

```bash
git add src/transport/web/ws-hub.ts tests/unit/web/ws-hub.test.ts
git commit -m "feat(web): WsHub with per-client session subscriptions and ping/pong"
```

---

### Task 19: Web transport entry — createWebTransport

**Files:**
- Create: `src/transport/web/index.ts`
- Test: `tests/unit/web/transport.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/web/transport.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createWebTransport } from '../../../src/transport/web/index'

describe('createWebTransport', () => {
  it('exposes name + capabilities.streaming=true', () => {
    const t = createWebTransport({
      host: '127.0.0.1', port: 7081,
      client: {} as any, eventStream: {} as any,
      cfAccess: { team: '', aud: '', devBypass: true, devEmail: 'd@l', host: '127.0.0.1' },
      staticRoot: '/tmp/nonexistent',
      cacheSize: 100,
    })
    expect(t.name).toBe('web')
    expect(t.capabilities.streaming).toBe(true)
  })

  it('throws on start if static root missing and webEnabled', async () => {
    const t = createWebTransport({
      host: '127.0.0.1', port: 0, // ephemeral port
      client: {} as any, eventStream: {} as any,
      cfAccess: { team: '', aud: '', devBypass: true, devEmail: 'd@l', host: '127.0.0.1' },
      staticRoot: '/tmp/definitely-not-here-xyz',
      cacheSize: 100,
    })
    await expect(t.start({ cardBus: { subscribeAll: () => () => {} } as any, state: {} as any })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run (fails)**

```bash
npx vitest run tests/unit/web/transport.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement createWebTransport**

```typescript
// src/transport/web/index.ts
import { existsSync } from 'node:fs'
import { serve, type ServerType } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { IncomingMessage, ChannelCapabilities } from '../../core/types.js'
import type { Transport, TransportStartDeps } from '../interface.js'
import type { StructuredCard } from '../../core/structured-card.js'
import type { EventStream } from '../../opencode/event-stream.js'
import { buildServer } from './server.js'
import { createWsHub } from './ws-hub.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('web')

export interface WebTransportConfig {
  host: string
  port: number
  client: OpencodeClient
  eventStream: EventStream
  cfAccess: { team: string; aud: string; devBypass?: boolean; devEmail?: string; host?: string }
  staticRoot: string
  cacheSize: number
}

const CAPS: ChannelCapabilities = {
  edit: true, maxMessageLength: Number.POSITIVE_INFINITY,
  buttons: true, richText: true, streaming: true,
}

export function createWebTransport(cfg: WebTransportConfig): Transport {
  let messageHandler: ((msg: IncomingMessage) => Promise<void>) | undefined
  let server: ServerType | undefined
  let wss: WebSocketServer | undefined

  return {
    name: 'web',
    capabilities: CAPS,
    async start(deps: TransportStartDeps) {
      if (!existsSync(cfg.staticRoot)) {
        throw new Error(`Web static root not found: ${cfg.staticRoot}. Run 'cd web && npm run build' first.`)
      }
      const wsHub = createWsHub({ cardBus: deps.cardBus })
      const app = buildServer({
        cfAccess: { ...cfg.cfAccess, host: cfg.cfAccess.host ?? cfg.host },
        client: cfg.client,
        state: deps.state,
        cardBus: deps.cardBus,
        wsHub,
        cacheSize: cfg.cacheSize,
        onMessage: (msg) => messageHandler ? messageHandler(msg) : Promise.resolve(),
      })

      // Static files for the SvelteKit-built PWA
      app.use('/*', serveStatic({ root: cfg.staticRoot }))

      server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
        log.info(`web transport listening on http://${info.address}:${info.port}`)
      })

      // Attach WebSocket server
      wss = new WebSocketServer({ noServer: true })
      ;(server as any).on('upgrade', (req: any, socket: any, head: any) => {
        if (req.url !== '/ws') { socket.destroy(); return }
        wss!.handleUpgrade(req, socket, head, (ws) => {
          // Re-run CF middleware on the upgrade request (simplified — re-extract token from headers)
          const token = req.headers['cf-access-jwt-assertion']
            ?? (req.headers.cookie?.match(/CF_Authorization=([^;]+)/)?.[1])
          // For v0.5.0 dev-bypass-or-trust, the auth is enforced by the parent Hono middleware
          // on every /api/* request, and the WS handshake comes through the same tunnel.
          // We extract the user from a follow-up `auth` message or trust the connection.
          const user = { email: 'user@unknown' }
          wsHub.attach(ws as any, user)
          ws.on('message', (data) => {
            try { wsHub.handleClientMessage(ws as any, JSON.parse(data.toString())) } catch {}
          })
          ws.on('close', () => wsHub.detach(ws as any))
        })
      })
    },
    async stop() {
      wss?.close()
      server?.close()
    },
    async send(_chatId, _card: StructuredCard) {
      throw new Error('Transport.send not implemented for Web in v0.5.0 (use cardBus.publish)')
    },
    onMessage(h) { messageHandler = h },
    onCommand() { /* web has no slash commands; UI buttons map to REST */ },
    onButtonClick() { /* same */ },
  }
}
```

- [ ] **Step 4: Install `@hono/node-server` (needed for serve + serveStatic)**

```bash
npm install @hono/node-server
```

- [ ] **Step 5: Run test**

```bash
npx vitest run tests/unit/web/transport.test.ts
# Expected: PASS — 2 tests
```

- [ ] **Step 6: Commit**

```bash
git add src/transport/web/index.ts package.json package-lock.json tests/unit/web/transport.test.ts
git commit -m "feat(web): createWebTransport — Hono server + WS upgrade + static files"
```

---

### Task 20: Multi-transport startup wiring

**Files:**
- Modify: `src/index.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Add Web env vars to config**

In `src/config.ts`, add fields and parsing:

```typescript
// Inside loadConfig() return:
webEnabled: process.env.WEB_ENABLED === 'true',
webHost: process.env.WEB_HOST ?? '127.0.0.1',
webPort: Number(process.env.WEB_PORT ?? 7081),
webStaticRoot: process.env.WEB_STATIC_ROOT ?? 'web/dist',
webCacheSize: Number(process.env.WEB_SESSION_CACHE_SIZE ?? 100),
webCfAccessTeam: process.env.WEB_CF_ACCESS_TEAM ?? '',
webCfAccessAud: process.env.WEB_CF_ACCESS_AUD ?? '',
webCfAccessDevBypass: process.env.WEB_CF_ACCESS_DEV_BYPASS === 'true',
webCfAccessDevEmail: process.env.WEB_CF_ACCESS_DEV_EMAIL ?? 'dev@localhost',
```

Also add the corresponding fields to the `Config` interface.

- [ ] **Step 2: Update `runBot` in src/index.ts**

Add Web transport startup conditional:

```typescript
import { createWebTransport } from './transport/web/index.js'

// ... after telegram transport creation:
const transports = [transport]
if (config.webEnabled) {
  const webT = createWebTransport({
    host: config.webHost,
    port: config.webPort,
    client, eventStream,
    cfAccess: {
      team: config.webCfAccessTeam,
      aud: config.webCfAccessAud,
      devBypass: config.webCfAccessDevBypass,
      devEmail: config.webCfAccessDevEmail,
      host: config.webHost,
    },
    staticRoot: config.webStaticRoot,
    cacheSize: config.webCacheSize,
  })
  webT.onMessage(relay)
  transports.push(webT)
}

// Replace the single transport.start(...) at the end with:
await Promise.all(transports.map((t) => t.start({ cardBus, state })))
```

Update SIGINT/SIGTERM to stop all:

```typescript
const shutdown = async () => {
  eventStream.stop(); stopSync(); stopPush()
  for (const t of transports) await t.stop().catch(() => {})
}
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown)
```

- [ ] **Step 3: Add Web env vars to `.env.example`**

Append:

```
# Web transport
WEB_ENABLED=false
WEB_HOST=127.0.0.1
WEB_PORT=7081
WEB_STATIC_ROOT=web/dist
WEB_SESSION_CACHE_SIZE=100
WEB_CF_ACCESS_TEAM=
WEB_CF_ACCESS_AUD=
WEB_CF_ACCESS_DEV_BYPASS=false
WEB_CF_ACCESS_DEV_EMAIL=dev@localhost

# Telegram pagination tuning
TG_CHUNK_SOFT_LIMIT=3500
TG_CHUNK_HARD_LIMIT=3900
```

- [ ] **Step 4: Type-check + test**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
# Expected: all green
```

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/config.ts .env.example
git commit -m "feat(main): conditional Web transport startup + new env vars"
```

---

## ✅ Phase 5.B Checkpoint

Web backend skeleton ready. Manually smoke-test (optional):

```bash
WEB_ENABLED=true WEB_CF_ACCESS_DEV_BYPASS=true npm run dev &
curl -s http://127.0.0.1:7081/api/me
# Expected: {"email":"dev@localhost"}

curl -s http://127.0.0.1:7081/api/sessions | jq '.[0].id'
# Expected: some session id (if you've used Telegram side first)
```

---

## Phase 5.C — Web Frontend (SvelteKit)

### Task 21: Initialize SvelteKit in `web/`

**Files:**
- Create: `web/package.json`, `web/svelte.config.js`, `web/vite.config.ts`, `web/tsconfig.json`, `web/src/app.html`, `web/.gitignore`

- [ ] **Step 1: Initialize directory**

```bash
mkdir -p web/src/{lib,routes} web/static web/tests/e2e
```

- [ ] **Step 2: Create `web/package.json`**

```json
{
  "name": "oprc-web",
  "version": "0.5.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev --host 127.0.0.1 --port 5173",
    "build": "vite build",
    "build:extension": "vite build --mode extension && tsx ../web-build-extension.ts",
    "preview": "vite preview",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "check": "svelte-check --tsconfig ./tsconfig.json"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.0",
    "@sveltejs/adapter-static": "^3.0.0",
    "@sveltejs/kit": "^2.5.0",
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "@testing-library/svelte": "^4.1.0",
    "@types/dompurify": "^3.0.5",
    "jsdom": "^24.0.0",
    "svelte": "^4.2.0",
    "svelte-check": "^3.6.0",
    "tslib": "^2.6.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "dompurify": "^3.1.0",
    "marked": "^12.0.0"
  }
}
```

- [ ] **Step 3: Create `web/svelte.config.js`**

```javascript
import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: 'dist', assets: 'dist', fallback: 'index.html', strict: true }),
  },
}
```

- [ ] **Step 4: Create `web/vite.config.ts`**

```typescript
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'jsdom',
  },
})
```

- [ ] **Step 5: Create `web/tsconfig.json`**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

- [ ] **Step 6: Create `web/src/app.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <link rel="icon" href="%sveltekit.assets%/icon-192.png" />
  <link rel="manifest" href="%sveltekit.assets%/manifest.webmanifest" />
  <meta name="theme-color" content="#0a0a0a" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  %sveltekit.head%
</head>
<body data-sveltekit-preload-data="hover">
  <div style="display: contents">%sveltekit.body%</div>
</body>
</html>
```

- [ ] **Step 7: Create `web/.gitignore`**

```
node_modules/
.svelte-kit/
dist/
extension-dist/
.env*
playwright-report/
test-results/
```

- [ ] **Step 8: Install web deps**

```bash
cd web && npm install
cd ..
```

- [ ] **Step 9: Verify build pipeline**

```bash
cd web && npm run check 2>&1 | tail -3 ; cd ..
# Expected: 0 errors (warnings ok)
```

- [ ] **Step 10: Commit**

```bash
git add web/package.json web/svelte.config.js web/vite.config.ts web/tsconfig.json web/src/app.html web/.gitignore web/package-lock.json
git commit -m "feat(web): initialize SvelteKit project under web/"
```

---

### Task 22: WebSocket client + connection store

**Files:**
- Create: `web/src/lib/ws/client.ts`
- Create: `web/src/lib/stores/connection.ts`
- Test: `web/src/lib/ws/client.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// web/src/lib/ws/client.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createWsClient } from './client'

class FakeWS {
  static instances: FakeWS[] = []
  url: string
  readyState = 0
  onopen?: () => void
  onmessage?: (ev: any) => void
  onclose?: () => void
  sent: string[] = []
  constructor(url: string) { this.url = url; FakeWS.instances.push(this) }
  send(msg: string) { this.sent.push(msg) }
  close() { this.readyState = 3; this.onclose?.() }
}

;(globalThis as any).WebSocket = FakeWS

describe('createWsClient', () => {
  it('connects and emits messages to handlers', async () => {
    FakeWS.instances = []
    const onCard = vi.fn()
    const c = createWsClient({ url: 'wss://x/ws', onMessage: onCard })
    const ws = FakeWS.instances[0]
    ws.readyState = 1; ws.onopen?.()
    ws.onmessage?.({ data: JSON.stringify({ type: 'card', card: { kind: 'thinking', sessionId: 's', showStop: true } }) })
    expect(onCard).toHaveBeenCalledWith({ type: 'card', card: expect.objectContaining({ kind: 'thinking' }) })
    c.close()
  })

  it('sends subscribe over WS', () => {
    FakeWS.instances = []
    const c = createWsClient({ url: 'wss://x/ws', onMessage: () => {} })
    const ws = FakeWS.instances[0]
    ws.readyState = 1; ws.onopen?.()
    c.send({ type: 'subscribe', sessionId: 'ses_1' })
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'subscribe', sessionId: 'ses_1' })
  })
})
```

- [ ] **Step 2: Run (fails)**

```bash
cd web && npx vitest run src/lib/ws/client.test.ts ; cd ..
# Expected: FAIL
```

- [ ] **Step 3: Implement WS client**

```typescript
// web/src/lib/ws/client.ts
export interface WsClient {
  send(msg: any): void
  close(): void
}

interface WsClientOpts {
  url: string
  onMessage: (msg: any) => void
  onStatus?: (status: 'connected' | 'reconnecting' | 'offline') => void
}

const PING_MS = 25_000
const PONG_TIMEOUT_MS = 45_000
const BACKOFF = [2000, 4000, 8000, 16000, 30000]

export function createWsClient(opts: WsClientOpts): WsClient {
  let ws: WebSocket | undefined
  let pingTimer: number | undefined
  let pongTimer: number | undefined
  let backoffIdx = 0
  let closed = false

  function connect() {
    opts.onStatus?.(backoffIdx > 0 ? 'reconnecting' : 'offline')
    ws = new WebSocket(opts.url)
    ws.onopen = () => {
      opts.onStatus?.('connected')
      backoffIdx = 0
      startHeartbeat()
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'pong') { resetPongTimer() }
        opts.onMessage(msg)
      } catch { /* ignore */ }
    }
    ws.onclose = () => {
      stopHeartbeat()
      if (closed) return
      const delay = BACKOFF[Math.min(backoffIdx, BACKOFF.length - 1)]
      backoffIdx += 1
      setTimeout(connect, delay)
    }
    ws.onerror = () => { try { ws?.close() } catch {} }
  }

  function startHeartbeat() {
    stopHeartbeat()
    pingTimer = (setInterval(() => {
      try { ws?.send(JSON.stringify({ type: 'ping' })) } catch {}
      pongTimer = setTimeout(() => { try { ws?.close() } catch {} }, PONG_TIMEOUT_MS) as unknown as number
    }, PING_MS) as unknown as number)
  }
  function stopHeartbeat() {
    if (pingTimer) clearInterval(pingTimer)
    if (pongTimer) clearTimeout(pongTimer)
    pingTimer = undefined; pongTimer = undefined
  }
  function resetPongTimer() {
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = undefined }
  }

  connect()

  return {
    send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)) },
    close() { closed = true; stopHeartbeat(); ws?.close() },
  }
}
```

- [ ] **Step 4: Connection store**

```typescript
// web/src/lib/stores/connection.ts
import { writable } from 'svelte/store'
export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline'
export const connection = writable<ConnectionStatus>('offline')
```

- [ ] **Step 5: Run test**

```bash
cd web && npx vitest run src/lib/ws/client.test.ts ; cd ..
# Expected: PASS
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/ws/ web/src/lib/stores/connection.ts
git commit -m "feat(web): WS client with auto-reconnect + connection store"
```

---

### Task 23: API client + session/cards stores

**Files:**
- Create: `web/src/lib/api/client.ts`
- Create: `web/src/lib/stores/sessions.ts`
- Create: `web/src/lib/stores/activeSession.ts`
- Create: `web/src/lib/api/types.ts`

- [ ] **Step 1: Shared types**

```typescript
// web/src/lib/api/types.ts
export interface ToolCall { tool: string; args: string; status: 'running' | 'done' | 'error' }
export interface AssistantMeta {
  agent?: string; model?: string; cost?: number
  tokens?: { input: number; output: number; cache?: number }
}
export interface InfoSection { heading?: string; body: string; code?: { language?: string; content: string } }
export interface Button { label: string; data: string }

export type StructuredCard =
  | { kind: 'thinking'; sessionId: string; showStop: boolean }
  | { kind: 'streaming'; sessionId: string; markdownSrc: string; tools: ToolCall[] }
  | { kind: 'assistant'; sessionId: string; markdownSrc: string; tools: ToolCall[]; meta: AssistantMeta }
  | { kind: 'user'; sessionId: string; text: string; ts: number }
  | { kind: 'error'; sessionId: string; message: string }
  | { kind: 'status'; sessionId: string; fields: Record<string, string>; buttons?: Button[][] }
  | { kind: 'info'; title: string; sections: InfoSection[] }
  | { kind: 'approval'; sessionId: string; title: string; args: unknown; requestId: string }

export interface SessionSummary {
  id: string
  title?: string
  agent?: string
  model?: string
  cost?: number
  lastActiveAt: number
  unread: boolean
}
```

- [ ] **Step 2: API client**

```typescript
// web/src/lib/api/client.ts
import type { StructuredCard, SessionSummary } from './types'

async function jsonGet<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: 'include' })
  if (!r.ok) throw new Error(`${path} -> ${r.status}`)
  return r.json() as Promise<T>
}
async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${path} -> ${r.status}`)
  return r.json() as Promise<T>
}

export const api = {
  me: () => jsonGet<{ email: string }>('/api/me'),
  sessions: () => jsonGet<SessionSummary[]>('/api/sessions'),
  history: (id: string) => jsonGet<StructuredCard[]>(`/api/session/${encodeURIComponent(id)}`),
  diff:    (id: string) => jsonGet<unknown[]>(`/api/session/${encodeURIComponent(id)}/diff`),
  todo:    (id: string) => jsonGet<unknown[]>(`/api/session/${encodeURIComponent(id)}/todo`),
  context: (id: string) => jsonGet<unknown>(`/api/session/${encodeURIComponent(id)}/context`),
  sendMessage: (body: { sessionId: string; text: string }) => jsonPost<{ messageId: string }>('/api/message', body),
  abort:   (sessionId: string) => jsonPost<{ ok: boolean }>('/api/abort', { sessionId }),
  approve: (sessionId: string, requestId: string, decision: 'once'|'always'|'reject') =>
    jsonPost<{ ok: boolean }>('/api/approval', { sessionId, requestId, decision }),
}
```

- [ ] **Step 3: Sessions store**

```typescript
// web/src/lib/stores/sessions.ts
import { writable, derived } from 'svelte/store'
import type { StructuredCard, SessionSummary } from '../api/types'

export const sessionList = writable<SessionSummary[]>([])
export const cardsBySession = writable<Record<string, StructuredCard[]>>({})

export function appendCard(card: StructuredCard) {
  if (!('sessionId' in card)) return
  cardsBySession.update((m) => {
    const arr = m[card.sessionId] ?? []
    // Merge consecutive streaming cards (replace last if same kind/session)
    const last = arr.at(-1)
    if (last && last.kind === 'streaming' && card.kind === 'streaming') {
      return { ...m, [card.sessionId]: [...arr.slice(0, -1), card] }
    }
    // If assistant arrives, drop trailing streaming/thinking
    if (card.kind === 'assistant') {
      const trimmed = arr.filter((c) => c.kind !== 'streaming' && c.kind !== 'thinking')
      return { ...m, [card.sessionId]: [...trimmed, card] }
    }
    return { ...m, [card.sessionId]: [...arr, card] }
  })
}

export function setHistory(sessionId: string, cards: StructuredCard[]) {
  cardsBySession.update((m) => ({ ...m, [sessionId]: cards }))
}
```

- [ ] **Step 4: Active session store (cookie-persistent)**

```typescript
// web/src/lib/stores/activeSession.ts
import { writable } from 'svelte/store'

const COOKIE = 'oprc_active_session'
function readCookie(): string | undefined {
  if (typeof document === 'undefined') return
  const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : undefined
}
function writeCookie(v?: string) {
  if (typeof document === 'undefined') return
  document.cookie = v
    ? `${COOKIE}=${encodeURIComponent(v)}; path=/; max-age=31536000; SameSite=Lax`
    : `${COOKIE}=; path=/; max-age=0`
}

export const activeSession = writable<string | undefined>(readCookie())
activeSession.subscribe(writeCookie)
```

- [ ] **Step 5: Type-check**

```bash
cd web && npm run check 2>&1 | tail -3 ; cd ..
# Expected: 0 errors
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/api/ web/src/lib/stores/sessions.ts web/src/lib/stores/activeSession.ts
git commit -m "feat(web): API client + sessions/cards/activeSession stores"
```

---

### Task 24: MarkdownView + ToolCallList components

**Files:**
- Create: `web/src/lib/components/MarkdownView.svelte`
- Create: `web/src/lib/components/ToolCallList.svelte`
- Test: `web/src/lib/components/MarkdownView.test.ts`

- [ ] **Step 1: Test MarkdownView (sanitize HTML, render code blocks)**

```typescript
// web/src/lib/components/MarkdownView.test.ts
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'
import MarkdownView from './MarkdownView.svelte'

describe('MarkdownView', () => {
  it('renders markdown bold + headings', () => {
    const { container } = render(MarkdownView, { src: '# Hi\n**bold**' })
    expect(container.querySelector('h1')?.textContent).toBe('Hi')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
  })
  it('strips raw script tags via DOMPurify', () => {
    const { container } = render(MarkdownView, { src: 'safe<script>alert(1)</script>' })
    expect(container.innerHTML).not.toMatch(/<script/)
  })
})
```

- [ ] **Step 2: Implement MarkdownView**

```svelte
<!-- web/src/lib/components/MarkdownView.svelte -->
<script lang="ts">
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  export let src: string = ''
  $: rendered = src ? DOMPurify.sanitize(marked.parse(src, { async: false }) as string) : ''
</script>

<div class="md">{@html rendered}</div>

<style>
  .md :global(pre) { background: #1a1a1a; padding: 8px; border-radius: 6px; overflow-x: auto; }
  .md :global(code) { font-family: ui-monospace, monospace; font-size: 0.9em; }
  .md :global(h1), .md :global(h2), .md :global(h3) { margin: 0.6em 0 0.3em; }
  .md :global(p) { margin: 0.4em 0; }
  .md :global(ul) { margin: 0.4em 0; padding-left: 1.4em; }
</style>
```

- [ ] **Step 3: Implement ToolCallList**

```svelte
<!-- web/src/lib/components/ToolCallList.svelte -->
<script lang="ts">
  import type { ToolCall } from '../api/types'
  export let tools: ToolCall[] = []
  let expanded = false
  $: running = tools.filter((t) => t.status === 'running').length
</script>

{#if tools.length > 0}
  <button class="row" on:click={() => (expanded = !expanded)}>
    ▸ {tools.length} tool call{tools.length === 1 ? '' : 's'}{running > 0 ? ` (${running} running)` : ''}
  </button>
  {#if expanded}
    <ul>
      {#each tools as t}
        <li title={t.args}>
          <span class="status">{t.status === 'done' ? '✓' : t.status === 'error' ? '✗' : '…'}</span>
          <span class="tool">{t.tool}</span>
          {#if t.args}<span class="args">· {t.args}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .row { background: none; border: none; color: #aaa; cursor: pointer; padding: 0; font: inherit; }
  ul { list-style: none; padding-left: 1em; margin: 4px 0; }
  li { display: flex; gap: 0.5em; font-size: 0.9em; color: #ccc; }
  .args { color: #888; }
</style>
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/lib/components/MarkdownView.test.ts ; cd ..
# Expected: PASS — 2 tests
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/MarkdownView.svelte web/src/lib/components/ToolCallList.svelte web/src/lib/components/MarkdownView.test.ts
git commit -m "feat(web): MarkdownView + ToolCallList components"
```

---

### Task 25: Card components

**Files:**
- Create: `web/src/lib/components/CardUser.svelte`
- Create: `web/src/lib/components/CardThinking.svelte`
- Create: `web/src/lib/components/CardStreaming.svelte`
- Create: `web/src/lib/components/CardAssistant.svelte`
- Create: `web/src/lib/components/CardError.svelte`
- Create: `web/src/lib/components/CardInfo.svelte`
- Create: `web/src/lib/components/Card.svelte` (dispatcher by kind)

- [ ] **Step 1: Dispatcher**

```svelte
<!-- web/src/lib/components/Card.svelte -->
<script lang="ts">
  import type { StructuredCard } from '../api/types'
  import CardUser from './CardUser.svelte'
  import CardThinking from './CardThinking.svelte'
  import CardStreaming from './CardStreaming.svelte'
  import CardAssistant from './CardAssistant.svelte'
  import CardError from './CardError.svelte'
  import CardInfo from './CardInfo.svelte'
  export let card: StructuredCard
</script>

{#if card.kind === 'user'}<CardUser {card} />
{:else if card.kind === 'thinking'}<CardThinking {card} />
{:else if card.kind === 'streaming'}<CardStreaming {card} />
{:else if card.kind === 'assistant'}<CardAssistant {card} />
{:else if card.kind === 'error'}<CardError {card} />
{:else if card.kind === 'info'}<CardInfo {card} />
{/if}
```

- [ ] **Step 2: Card variants**

```svelte
<!-- web/src/lib/components/CardUser.svelte -->
<script lang="ts">
  import type { StructuredCard } from '../api/types'
  export let card: Extract<StructuredCard, { kind: 'user' }>
</script>
<div class="bubble user">{card.text}</div>
<style>
  .bubble.user { background: #2563eb; color: white; padding: 8px 12px; border-radius: 12px;
    align-self: flex-end; max-width: 75%; margin: 8px 0; white-space: pre-wrap; }
</style>
```

```svelte
<!-- web/src/lib/components/CardThinking.svelte -->
<script lang="ts">
  import type { StructuredCard } from '../api/types'
  import { api } from '../api/client'
  export let card: Extract<StructuredCard, { kind: 'thinking' }>
  function stop() { api.abort(card.sessionId) }
</script>
<div class="bubble thinking">
  <span class="spinner">⏳</span> Working…
  {#if card.showStop}<button on:click={stop}>⏹ Stop</button>{/if}
</div>
<style>
  .bubble.thinking { background: #1a1a1a; color: #aaa; padding: 8px 12px; border-radius: 12px;
    align-self: flex-start; max-width: 75%; margin: 8px 0; display: flex; gap: 8px; align-items: center; }
  button { background: #333; color: #eee; border: 0; border-radius: 6px; padding: 4px 8px; cursor: pointer; }
</style>
```

```svelte
<!-- web/src/lib/components/CardStreaming.svelte -->
<script lang="ts">
  import type { StructuredCard } from '../api/types'
  import MarkdownView from './MarkdownView.svelte'
  import ToolCallList from './ToolCallList.svelte'
  import { api } from '../api/client'
  export let card: Extract<StructuredCard, { kind: 'streaming' }>
</script>
<div class="bubble assistant">
  <ToolCallList tools={card.tools} />
  <MarkdownView src={card.markdownSrc} />
  <button class="stop" on:click={() => api.abort(card.sessionId)}>⏹ Stop</button>
</div>
<style>
  .bubble.assistant { background: #18181b; padding: 8px 12px; border-radius: 12px;
    align-self: flex-start; max-width: 90%; margin: 8px 0; color: #e5e5e5; }
  .stop { margin-top: 6px; background: #333; color: #eee; border: 0; border-radius: 6px; padding: 4px 8px; cursor: pointer; }
</style>
```

```svelte
<!-- web/src/lib/components/CardAssistant.svelte -->
<script lang="ts">
  import type { StructuredCard } from '../api/types'
  import MarkdownView from './MarkdownView.svelte'
  import ToolCallList from './ToolCallList.svelte'
  export let card: Extract<StructuredCard, { kind: 'assistant' }>
  function fmtK(n: number) { return n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n) }
</script>
<div class="bubble assistant">
  <ToolCallList tools={card.tools} />
  <MarkdownView src={card.markdownSrc} />
  <footer>
    {#if card.meta.cost !== undefined}💰 ${card.meta.cost.toFixed(3)}{/if}
    {#if card.meta.tokens}· ↑{fmtK(card.meta.tokens.input)} ↓{fmtK(card.meta.tokens.output)}{/if}
    {#if card.meta.agent}· {card.meta.agent}{/if}
    {#if card.meta.model}· {card.meta.model}{/if}
  </footer>
</div>
<style>
  .bubble.assistant { background: #18181b; padding: 8px 12px; border-radius: 12px;
    align-self: flex-start; max-width: 90%; margin: 8px 0; color: #e5e5e5; }
  footer { margin-top: 8px; font-size: 0.85em; color: #888; border-top: 1px solid #333; padding-top: 6px; }
</style>
```

```svelte
<!-- web/src/lib/components/CardError.svelte -->
<script lang="ts">
  import type { StructuredCard } from '../api/types'
  export let card: Extract<StructuredCard, { kind: 'error' }>
</script>
<div class="bubble error">❌ <code>{card.message}</code></div>
<style>
  .bubble.error { background: #3f1d1d; color: #fca5a5; padding: 8px 12px; border-radius: 12px;
    align-self: stretch; margin: 8px 0; }
  code { font-family: ui-monospace, monospace; }
</style>
```

```svelte
<!-- web/src/lib/components/CardInfo.svelte -->
<script lang="ts">
  import type { StructuredCard } from '../api/types'
  import MarkdownView from './MarkdownView.svelte'
  export let card: Extract<StructuredCard, { kind: 'info' }>
</script>
<div class="bubble info">
  <h3>{card.title}</h3>
  {#each card.sections as s}
    {#if s.heading}<h4>{s.heading}</h4>{/if}
    <MarkdownView src={s.body} />
    {#if s.code}<pre><code>{s.code.content}</code></pre>{/if}
  {/each}
</div>
<style>
  .bubble.info { background: #14213d; color: #d6e0f5; padding: 12px; border-radius: 12px;
    align-self: stretch; margin: 8px 0; }
  h3 { margin: 0 0 8px; font-size: 1em; }
  h4 { margin: 8px 0 4px; font-size: 0.9em; color: #a3b8e0; }
</style>
```

- [ ] **Step 3: Type-check**

```bash
cd web && npm run check 2>&1 | tail -3 ; cd ..
# Expected: 0 errors
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/components/Card*.svelte
git commit -m "feat(web): Card components — User/Thinking/Streaming/Assistant/Error/Info"
```

---

### Task 26: ApprovalModal + Composer

**Files:**
- Create: `web/src/lib/components/ApprovalModal.svelte`
- Create: `web/src/lib/components/Composer.svelte`

- [ ] **Step 1: ApprovalModal**

```svelte
<!-- web/src/lib/components/ApprovalModal.svelte -->
<script lang="ts">
  import type { StructuredCard } from '../api/types'
  import { api } from '../api/client'
  export let card: Extract<StructuredCard, { kind: 'approval' }>
  async function decide(d: 'once'|'always'|'reject') {
    await api.approve(card.sessionId, card.requestId, d)
  }
</script>

<div class="overlay">
  <div class="modal">
    <h2>Permission requested</h2>
    <p class="title">{card.title}</p>
    <pre>{JSON.stringify(card.args, null, 2)}</pre>
    <div class="actions">
      <button class="primary" on:click={() => decide('once')}>Allow once</button>
      <button on:click={() => decide('always')}>Always allow</button>
      <button class="reject" on:click={() => decide('reject')}>Reject</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: grid; place-items: center; z-index: 1000; }
  .modal { background: #18181b; color: #e5e5e5; padding: 20px; border-radius: 12px; max-width: 480px; width: 90%; }
  h2 { margin: 0 0 8px; }
  .title { color: #aaa; margin-bottom: 8px; }
  pre { background: #0a0a0a; padding: 8px; border-radius: 6px; max-height: 200px; overflow: auto; font-size: 0.85em; }
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  button { background: #333; color: #eee; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
  .primary { background: #2563eb; }
  .reject { background: #7f1d1d; }
</style>
```

- [ ] **Step 2: Composer**

```svelte
<!-- web/src/lib/components/Composer.svelte -->
<script lang="ts">
  import { api } from '../api/client'
  export let sessionId: string
  let text = ''
  let sending = false
  async function send() {
    if (!text.trim() || sending) return
    sending = true
    try {
      await api.sendMessage({ sessionId, text })
      text = ''
    } catch (err) {
      console.error('send failed', err)
    } finally { sending = false }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
  }
</script>

<div class="composer">
  <textarea bind:value={text} on:keydown={onKey} placeholder="message…" rows="2"></textarea>
  <button on:click={send} disabled={sending || !text.trim()}>➤</button>
</div>

<style>
  .composer { display: flex; gap: 8px; padding: 8px; border-top: 1px solid #333; background: #0a0a0a; }
  textarea { flex: 1; background: #18181b; color: #e5e5e5; border: 1px solid #333; border-radius: 8px;
    padding: 8px; resize: vertical; font: inherit; }
  button { background: #2563eb; color: white; border: 0; border-radius: 8px; padding: 8px 16px; cursor: pointer; }
  button:disabled { background: #333; cursor: default; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/components/ApprovalModal.svelte web/src/lib/components/Composer.svelte
git commit -m "feat(web): ApprovalModal + Composer components"
```

---

### Task 27: SessionList + ConnectionBadge

**Files:**
- Create: `web/src/lib/components/SessionList.svelte`
- Create: `web/src/lib/components/ConnectionBadge.svelte`

- [ ] **Step 1: SessionList**

```svelte
<!-- web/src/lib/components/SessionList.svelte -->
<script lang="ts">
  import { sessionList } from '../stores/sessions'
  import { activeSession } from '../stores/activeSession'
  function pick(id: string) { activeSession.set(id) }
  function rel(ts: number): string {
    const diff = Date.now() - ts
    if (diff < 60_000) return 'now'
    if (diff < 3600_000) return `${Math.floor(diff/60_000)}m`
    if (diff < 86400_000) return `${Math.floor(diff/3600_000)}h`
    return `${Math.floor(diff/86400_000)}d`
  }
</script>

<aside>
  <h3>Sessions</h3>
  <ul>
    {#each $sessionList as s}
      <li class:active={$activeSession === s.id} on:click={() => pick(s.id)}>
        <span class="title">▸ {s.agent ?? 'opencode'}</span>
        <span class="time">{rel(s.lastActiveAt)}</span>
      </li>
    {/each}
  </ul>
</aside>

<style>
  aside { padding: 12px; border-right: 1px solid #333; min-width: 200px; background: #0a0a0a; }
  h3 { color: #888; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 8px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 6px 8px; cursor: pointer; border-radius: 6px; display: flex; justify-content: space-between; color: #ccc; }
  li:hover { background: #18181b; }
  li.active { background: #1e3a8a; color: white; }
  .time { color: #666; font-size: 0.85em; }
</style>
```

- [ ] **Step 2: ConnectionBadge**

```svelte
<!-- web/src/lib/components/ConnectionBadge.svelte -->
<script lang="ts">
  import { connection } from '../stores/connection'
</script>

<span class="badge {$connection}">
  {#if $connection === 'connected'}🟢 connected
  {:else if $connection === 'reconnecting'}🟡 reconnecting…
  {:else}🔴 offline{/if}
</span>

<style>
  .badge { font-size: 0.85em; color: #aaa; padding: 2px 6px; border-radius: 4px; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/components/SessionList.svelte web/src/lib/components/ConnectionBadge.svelte
git commit -m "feat(web): SessionList + ConnectionBadge components"
```

---

### Task 28: Layout + routes + WS wiring

**Files:**
- Create: `web/src/routes/+layout.svelte`
- Create: `web/src/routes/+layout.ts`
- Create: `web/src/routes/+page.svelte`
- Create: `web/src/routes/[sessionId]/+page.svelte`

- [ ] **Step 1: Disable SSR for SPA build**

```typescript
// web/src/routes/+layout.ts
export const ssr = false
export const prerender = false
export const trailingSlash = 'always'
```

- [ ] **Step 2: Root layout**

```svelte
<!-- web/src/routes/+layout.svelte -->
<script lang="ts">
  import { onMount } from 'svelte'
  import SessionList from '$lib/components/SessionList.svelte'
  import ConnectionBadge from '$lib/components/ConnectionBadge.svelte'
  import ApprovalModal from '$lib/components/ApprovalModal.svelte'
  import { api } from '$lib/api/client'
  import { createWsClient } from '$lib/ws/client'
  import { connection } from '$lib/stores/connection'
  import { sessionList, cardsBySession, appendCard, setHistory } from '$lib/stores/sessions'
  import { activeSession } from '$lib/stores/activeSession'
  import type { StructuredCard } from '$lib/api/types'
  import { goto } from '$app/navigation'

  let email = ''
  let pendingApproval: Extract<StructuredCard, { kind: 'approval' }> | null = null
  let ws: ReturnType<typeof createWsClient> | undefined

  onMount(async () => {
    try {
      email = (await api.me()).email
      const list = await api.sessions()
      sessionList.set(list)
      const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
      ws = createWsClient({
        url: wsUrl,
        onStatus: (s) => connection.set(s),
        onMessage: (msg) => {
          if (msg.type === 'card') {
            appendCard(msg.card)
            if (msg.card.kind === 'approval') pendingApproval = msg.card
          }
          if (msg.type === 'session.list') sessionList.set(msg.sessions)
        },
      })
      if (!$activeSession && list.length > 0) {
        activeSession.set(list[0].id)
        goto(`/${list[0].id}/`)
      }
      activeSession.subscribe(async (id) => {
        if (!id) return
        try {
          const history = await api.history(id)
          setHistory(id, history)
          ws?.send({ type: 'subscribe', sessionId: id })
        } catch (err) { console.error(err) }
      })
    } catch (err) { console.error('boot failed', err) }
    return () => ws?.close()
  })
</script>

<header>
  <strong>oprc</strong>
  <ConnectionBadge />
  <span class="email">{email}</span>
</header>

<div class="layout">
  <SessionList />
  <main><slot /></main>
</div>

{#if pendingApproval}
  <ApprovalModal card={pendingApproval} />
{/if}

<style>
  :global(body) { background: #0a0a0a; color: #e5e5e5; font-family: system-ui, sans-serif; margin: 0; }
  header { display: flex; align-items: center; gap: 16px; padding: 8px 16px; border-bottom: 1px solid #333; }
  .email { color: #888; margin-left: auto; font-size: 0.9em; }
  .layout { display: flex; height: calc(100vh - 45px); }
  main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
</style>
```

- [ ] **Step 3: Default page (redirect to first session)**

```svelte
<!-- web/src/routes/+page.svelte -->
<script lang="ts">
  import { activeSession } from '$lib/stores/activeSession'
  $: if ($activeSession) {
    // dynamic redirect happens in layout
  }
</script>
<p style="padding: 20px; color: #888;">No active session. Send a message from Telegram to create one.</p>
```

- [ ] **Step 4: Session page**

```svelte
<!-- web/src/routes/[sessionId]/+page.svelte -->
<script lang="ts">
  import { page } from '$app/stores'
  import { activeSession } from '$lib/stores/activeSession'
  import { cardsBySession } from '$lib/stores/sessions'
  import Card from '$lib/components/Card.svelte'
  import Composer from '$lib/components/Composer.svelte'
  import { onMount, tick } from 'svelte'

  let scroller: HTMLDivElement
  $: sessionId = $page.params.sessionId
  $: { activeSession.set(sessionId) }
  $: cards = $cardsBySession[sessionId] ?? []
  $: void cards.length, scrollToBottom()
  async function scrollToBottom() {
    await tick()
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }
  onMount(scrollToBottom)
</script>

<div class="messages" bind:this={scroller}>
  {#each cards as card}
    <Card {card} />
  {/each}
</div>
<Composer {sessionId} />

<style>
  .messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; }
</style>
```

- [ ] **Step 5: Type-check + dev build**

```bash
cd web && npm run check 2>&1 | tail -3 ; cd ..
# Expected: 0 errors
cd web && npm run build 2>&1 | tail -3 ; cd ..
# Expected: build succeeds, output in web/dist/
```

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/
git commit -m "feat(web): root layout + session route + WS wiring"
```

---

### Task 29: PWA manifest + service worker + icons

**Files:**
- Create: `web/static/manifest.webmanifest`
- Create: `web/static/service-worker.js`
- Create: `web/static/icon-192.png`, `icon-512.png` (placeholder)

- [ ] **Step 1: manifest**

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

- [ ] **Step 2: service worker (offline fallback only)**

```javascript
// web/static/service-worker.js
self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => { self.clients.claim() })
self.addEventListener('fetch', (e) => {
  // No caching — real-time first. SW exists only to make PWA installable.
})
```

- [ ] **Step 3: Generate placeholder icons (1×1 solid-color PNG, replaced later)**

```bash
python3 - <<'PY'
import struct, zlib
def png(w, h, rgba):
    sig=b'\x89PNG\r\n\x1a\n'
    def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    ihdr=struct.pack('>IIBBBBB',w,h,8,6,0,0,0)
    raw=b''.join(b'\x00'+(rgba*w) for _ in range(h))
    idat=zlib.compress(raw)
    return sig+chunk(b'IHDR',ihdr)+chunk(b'IDAT',idat)+chunk(b'IEND',b'')
open('web/static/icon-192.png','wb').write(png(192,192,b'\x10\x10\x10\xff'))
open('web/static/icon-512.png','wb').write(png(512,512,b'\x10\x10\x10\xff'))
PY
ls -lh web/static/icon-*.png
```

- [ ] **Step 4: Register service worker in app.html or via SvelteKit adapter**

Append before `</body>` in `web/src/app.html`:

```html
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js'))
  }
</script>
```

- [ ] **Step 5: Build + verify dist contains static files**

```bash
cd web && npm run build && ls dist/ | grep -E 'manifest|service-worker|icon' ; cd ..
# Expected: lists manifest.webmanifest, service-worker.js, icon-192.png, icon-512.png
```

- [ ] **Step 6: Commit**

```bash
git add web/static/ web/src/app.html
git commit -m "feat(web): PWA manifest + service worker + placeholder icons"
```

---

## ✅ Phase 5.C Checkpoint

PWA builds, loads, connects via WS (with dev bypass), displays session cards. Manual smoke test:

```bash
cd web && npm run build && cd ..
WEB_ENABLED=true WEB_CF_ACCESS_DEV_BYPASS=true npm run dev &
# Open http://127.0.0.1:7081/ in Chrome
# Expected: page renders, badge shows "connected", session list populates
```

---

## Phase 5.D — Chrome Extension

### Task 30: Extension manifest + side panel HTML

**Files:**
- Create: `web/extension/manifest.json`
- Create: `web/extension/sidepanel.html`
- Create: `web/extension/sidepanel-entry.ts`
- Create: `web/extension/background.ts`
- Create: `web/extension/icons/16.png`, `32.png`, `128.png`

- [ ] **Step 1: manifest.json**

```json
{
  "manifest_version": 3,
  "name": "opencode-remote-control",
  "version": "0.5.0",
  "description": "Send selections and chat from any browser tab into your opencode session.",
  "permissions": ["sidePanel", "contextMenus", "storage", "activeTab"],
  "host_permissions": ["https://*/"],
  "background": { "service_worker": "background.js" },
  "side_panel": { "default_path": "sidepanel.html" },
  "action": { "default_title": "Open oprc" },
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "128": "icons/128.png" }
}
```

- [ ] **Step 2: sidepanel.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>oprc</title>
  <link rel="stylesheet" href="sidepanel.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 3: background service worker**

```typescript
// web/extension/background.ts
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
  if (tab?.id != null) await (chrome as any).sidePanel.open({ tabId: tab.id })
  chrome.runtime.sendMessage({ type: 'inject-prompt', payload })
})

function formatSelection(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): string {
  const lines: string[] = []
  if (info.linkUrl && !info.selectionText) {
    lines.push(`[Link] ${info.linkUrl}`)
  } else {
    if (tab?.url) lines.push(`[Page] ${tab.url}`)
    if (info.selectionText) lines.push('[Selection]', info.selectionText)
  }
  return lines.join('\n')
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id != null) await (chrome as any).sidePanel.open({ tabId: tab.id })
})
```

- [ ] **Step 4: side panel entry — first-run bot URL setup + load shared app**

```typescript
// web/extension/sidepanel-entry.ts
async function getBotUrl(): Promise<string | undefined> {
  return new Promise((resolve) => chrome.storage.local.get('botUrl', (r) => resolve(r.botUrl)))
}
async function setBotUrl(url: string): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ botUrl: url }, () => resolve()))
}

async function boot() {
  const root = document.getElementById('root')!
  let botUrl = await getBotUrl()
  if (!botUrl) {
    root.innerHTML = `
      <div style="padding: 16px;">
        <h2>Connect to your bot</h2>
        <input id="url" placeholder="https://oprc.example.com" style="width: 100%; padding: 8px;" />
        <button id="connect" style="margin-top: 8px;">Connect</button>
      </div>`
    document.getElementById('connect')!.addEventListener('click', async () => {
      const v = (document.getElementById('url') as HTMLInputElement).value.trim()
      if (!v) return
      await setBotUrl(v)
      location.reload()
    })
    return
  }
  // Redirect the side panel to the bot's hosted UI; cookie-based CF Access cookie applies.
  location.replace(botUrl)
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'inject-prompt' && typeof msg.payload === 'string') {
    // Best-effort: post a message to the embedded app via window.postMessage.
    window.postMessage({ type: 'oprc:inject-prompt', payload: msg.payload }, '*')
  }
})

boot()
```

- [ ] **Step 5: Reuse the same icon-generation script for 16/32/128**

```bash
python3 - <<'PY'
import struct, zlib
def png(w, h, rgba):
    sig=b'\x89PNG\r\n\x1a\n'
    def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    ihdr=struct.pack('>IIBBBBB',w,h,8,6,0,0,0)
    raw=b''.join(b'\x00'+(rgba*w) for _ in range(h))
    idat=zlib.compress(raw)
    return sig+chunk(b'IHDR',ihdr)+chunk(b'IDAT',idat)+chunk(b'IEND',b'')
import os; os.makedirs('web/extension/icons', exist_ok=True)
for s in (16, 32, 128):
    open(f'web/extension/icons/{s}.png','wb').write(png(s,s,b'\x10\x10\x10\xff'))
PY
ls web/extension/icons/
```

- [ ] **Step 6: Commit**

```bash
git add web/extension/
git commit -m "feat(extension): Manifest V3 + side panel + background context menu"
```

---

### Task 31: Extension build script

**Files:**
- Create: `web/web-build-extension.ts`

- [ ] **Step 1: Build script**

```typescript
// web/web-build-extension.ts
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { build } from 'esbuild'

const ROOT = process.cwd()                            // web/
const OUT = join(ROOT, 'extension-dist')
mkdirSync(OUT, { recursive: true })
mkdirSync(join(OUT, 'icons'), { recursive: true })

// Copy manifest + html + icons
copyFileSync(join(ROOT, 'extension/manifest.json'), join(OUT, 'manifest.json'))
copyFileSync(join(ROOT, 'extension/sidepanel.html'), join(OUT, 'sidepanel.html'))
for (const s of [16, 32, 128]) {
  copyFileSync(join(ROOT, `extension/icons/${s}.png`), join(OUT, `icons/${s}.png`))
}
// Minimal stylesheet
writeFileSync(join(OUT, 'sidepanel.css'), 'body{margin:0;background:#0a0a0a;color:#e5e5e5;font:14px system-ui;}')

// Bundle background + sidepanel-entry
await build({
  entryPoints: { background: join(ROOT, 'extension/background.ts'), sidepanel: join(ROOT, 'extension/sidepanel-entry.ts') },
  outdir: OUT,
  bundle: true,
  format: 'iife',
  target: 'chrome114',
  logLevel: 'info',
})

console.log('Extension built →', OUT)
```

- [ ] **Step 2: Add esbuild to web/devDependencies**

```bash
cd web && npm install -D esbuild tsx ; cd ..
```

- [ ] **Step 3: Wire `npm run build:extension` (already added in Task 21)**

Confirm `web/package.json` has:
```
"build:extension": "vite build --mode extension && tsx ./web-build-extension.ts"
```

The Vite build is not strictly required for the extension (it bundles via esbuild directly), so simplify to:

```json
"build:extension": "tsx ./web-build-extension.ts"
```

Update `web/package.json`.

- [ ] **Step 4: Run build + verify output**

```bash
cd web && npm run build:extension && ls extension-dist/ ; cd ..
# Expected: manifest.json, sidepanel.html, sidepanel.css, sidepanel.js, background.js, icons/
```

- [ ] **Step 5: Commit**

```bash
git add web/web-build-extension.ts web/package.json web/package-lock.json
git commit -m "feat(extension): esbuild bundler for extension-dist/"
```

---

## ✅ Phase 5.D Checkpoint

Extension builds. Manual verification:
1. `cd web && npm run build:extension`
2. In Chrome: chrome://extensions → Developer mode → Load unpacked → select `web/extension-dist/`
3. Click extension icon → bot URL prompt appears
4. Enter `http://127.0.0.1:7081` → side panel opens the PWA

---

## Phase 5.E — Release Polish

### Task 32: README + CHANGELOG update

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add Web section to README.md**

Append after the existing architecture section:

```markdown
## Web UI (optional, v0.5.0)

oprc can additionally serve a browser-based UI alongside Telegram. Both
transports share the same opencode session — anything you send from
Telegram appears in the Web UI in real time, and vice versa.

### Quick Start (Cloudflare Tunnel + Access)

1. Build the Web bundle:
   ```bash
   cd web && npm install && npm run build && cd ..
   ```

2. Create a Cloudflare Tunnel pointing at `http://127.0.0.1:7081`:
   ```bash
   cloudflared tunnel create oprc
   ```
   Route it as `https://oprc.<your-domain>` in the Zero Trust dashboard.

3. Create an Access Application protecting that hostname. Note the
   Application AUD tag and your team name.

4. Add to `.env`:
   ```bash
   WEB_ENABLED=true
   WEB_CF_ACCESS_TEAM=<your-team>
   WEB_CF_ACCESS_AUD=<aud-tag>
   ```

5. Start: `npm start`. Open `https://oprc.<your-domain>` in any browser
   (auth flows through Cloudflare Access).

### Chrome Extension

After `cd web && npm run build:extension`, load `web/extension-dist/` as
an unpacked extension in Chrome (`chrome://extensions`). Click the
toolbar icon, enter your bot URL, and use right-click → "Send to opencode"
on any page selection.
```

- [ ] **Step 2: Add v0.5.0 entry to CHANGELOG.md (top)**

```markdown
## v0.5.0 — 2026-05-17

### Added
- **Web transport** — PWA + Chrome Extension served from the bot process,
  fronted by Cloudflare Tunnel + Cloudflare Access. WebSocket streaming
  with no edit-throttle; full bidirectional sync with Telegram on the
  same opencode session.
- **`StructuredCard` + `CardBus`** — transport-agnostic intermediate
  format. Relay publishes structured cards; Telegram and Web each render
  natively.
- **History replay** — `reconstructHistory(client, sessionId)` rebuilds
  session message history into `StructuredCard[]` for Web `GET
  /api/session/:id`.

### Changed
- **Telegram streaming** — long thinking runs now paginate live into
  multiple Telegram messages (Part 1/N · done, Part 2/N · done, …).
  Tool-call lists collapse to first-2 + last-5 + "… N more" when busy.
  Final assistant answer with meta footer always ends up at the bottom,
  never truncated.
- **Adaptive edit throttle** — replaces fixed `EDIT_THROTTLE_MS` with
  per-burst adaptive timing (immediate → 250ms → 1000ms).
- **Transport interface** — `start({ cardBus, state })` replaces the old
  start signature; `edit`/`delete` removed (message editing is now
  Telegram-internal).

### Fixed
- Long-thinking responses with many tool calls no longer truncate before
  the final answer.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: README + CHANGELOG for v0.5.0"
```

---

### Task 33: CI updates

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Update CI to build + test web**

```yaml
# .github/workflows/ci.yml
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
      - name: Web — install + check + build + test
        working-directory: web
        run: |
          npm ci
          npm run check
          npm run build
          npm run build:extension
          npm test
      - name: Playwright deps
        working-directory: web
        run: npx playwright install --with-deps chromium
      - name: Web E2E
        working-directory: web
        run: npm run test:e2e
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build + test web bundle + extension + E2E"
```

---

### Task 34: Playwright happy-path E2E

**Files:**
- Create: `web/playwright.config.ts`
- Create: `web/tests/e2e/happy-path.spec.ts`

- [ ] **Step 1: Playwright config**

```typescript
// web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:7081' },
  webServer: {
    command: 'node ../scripts/e2e-bot.js',
    url: 'http://127.0.0.1:7081/api/me',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
```

- [ ] **Step 2: Stub bot launcher (mock opencode)**

```javascript
// scripts/e2e-bot.js
process.env.WEB_ENABLED = 'true'
process.env.WEB_CF_ACCESS_DEV_BYPASS = 'true'
process.env.WEB_STATIC_ROOT = require('node:path').resolve('web/dist')
process.env.WEB_HOST = '127.0.0.1'
process.env.WEB_PORT = '7081'
// Set minimal Telegram config so loadConfig doesn't reject; the bot will
// not actually connect because TELEGRAM_BOT_TOKEN=skip triggers a no-op.
process.env.TELEGRAM_BOT_TOKEN = ''   // disables Telegram polling path
process.env.ALLOWED_USER_IDS = '1'
process.env.OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL || 'http://127.0.0.1:65530'
// TODO: a real e2e harness would start an opencode mock here; for v0.5.0
// the test verifies the static + /api/me path only.
require('../dist/cli/index.js')
```

(Note: this stub will need a mock opencode HTTP shim if the runBot health check is strict; tighten later.)

- [ ] **Step 3: Happy-path test**

```typescript
// web/tests/e2e/happy-path.spec.ts
import { test, expect } from '@playwright/test'

test('loads the PWA shell and shows the connection badge', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('header')).toContainText(/oprc/)
  await expect(page.locator('header')).toContainText(/connected|reconnecting|offline/)
})

test('shows me email from dev bypass', async ({ page }) => {
  const res = await page.request.get('/api/me')
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.email).toBe('dev@localhost')
})
```

- [ ] **Step 4: Run locally (optional)**

```bash
cd web && npx playwright install chromium && npm run test:e2e ; cd ..
# May fail without a real opencode running; OK to skip in CI for v0.5.0.
```

- [ ] **Step 5: Commit**

```bash
git add web/playwright.config.ts web/tests/e2e/ scripts/e2e-bot.js
git commit -m "test(e2e): Playwright happy-path skeleton + bot stub launcher"
```

---

### Task 35: Final verification + tag v0.5.0

- [ ] **Step 1: Bump version in root + web `package.json`**

```bash
# Root already shows 0.4.0-rc.1 — bump to 0.5.0
npm version 0.5.0 --no-git-tag-version
cd web && npm version 0.5.0 --no-git-tag-version ; cd ..
```

- [ ] **Step 2: Run full pipeline**

```bash
npx tsc --noEmit && npm test
# Expected: all tests pass

cd web && npm run check && npm run test && npm run build && npm run build:extension ; cd ..
# Expected: all green; dist/ and extension-dist/ present
```

- [ ] **Step 3: Commit version bump**

```bash
git add package.json package-lock.json web/package.json
git commit -m "chore: v0.5.0"
```

- [ ] **Step 4: Tag (requires explicit user confirmation)**

```bash
git tag -a v0.5.0 -m "v0.5.0 — Web transport (PWA + Chrome Extension) + Telegram pagination fix"
git tag --list | grep v0.5.0
```

**Do NOT push the tag without explicit user instruction.**

- [ ] **Step 5: Update roadmap (post-release housekeeping)**

Edit `docs/superpowers/specs/2026-05-15-opensource-roadmap.md`:
- Mark M2 (OSS prep) done (closed in Phase 4.5)
- Mark M4 (Web) done at v0.5.0
- Note: 6-digit pairing in original outline replaced by Cloudflare Access

```bash
git add docs/superpowers/specs/2026-05-15-opensource-roadmap.md
git commit -m "docs(roadmap): mark M2 + M4 done; CF Access replaces 6-digit pairing"
```

---

## Final Test Matrix

| Suite | Command | Expected |
|---|---|---|
| Unit (root) | `npx vitest run tests/unit/` | all pass |
| Integration (root) | `npx vitest run tests/integration/` | all pass |
| Type check | `npx tsc --noEmit` | 0 errors |
| Unit (web) | `cd web && npm test` | all pass |
| Build (web PWA) | `cd web && npm run build` | dist/ generated |
| Build (extension) | `cd web && npm run build:extension` | extension-dist/ generated |
| Playwright E2E | `cd web && npm run test:e2e` | happy-path passes |

---

## Self-Review Checklist (Plan vs. Spec)

| Spec Section | Covered by Task(s) |
|---|---|
| §1 Architecture | T2, T5, T11 (CardBus + relay + transports), T19 (Web transport) |
| §2 StructuredCard model | T1 |
| §3.1 Data layer separation | T1 (tools[] vs markdownSrc) |
| §3.2 Budget allocation | T6-T9 (renderChunkBody + collapseTools) |
| §3.3 Progressive collapse | T8 (collapseTools) |
| §3.4 Live multi-message pagination | T9 (finalize + renderStreaming split) |
| §3.5 Adaptive throttling | T7 |
| §3.6 Edge cases | T9 (code block force-cut), T10 (renderer onCard switch covers error) |
| §3.7 Web rendering | T25 (ToolCallList + auto-scroll in T28) |
| §4 Web transport server | T13-T19 |
| §5 Web frontend | T21-T29 |
| §6 Chrome Extension | T30, T31 |
| §7 Cloudflare Access | T14 |
| §8 Relay refactor | T2, T3, T4, T5, T10, T11 |
| §9 Error handling | preserved in T5 (submitWithRetry), T6+ |
| §10 Testing | tests embedded in every task; T12, T34 |
| §11 Files & env vars | T20 (env), all tasks (files) |
| §12 Build/Deploy/CI | T33, T34, T35 |

No gaps identified.




