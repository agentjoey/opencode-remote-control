# Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate to SDK-native `session.prompt()` submission, introduce Transport abstraction, finish stability, prepare for OSS publish.

**Architecture:** Replace TUI-inject submission with `client.session.prompt()`. Split current `src/bot/` into `src/core/` (channel-agnostic relay + state) and `src/transport/telegram/` (Telegram-specific implementation of Transport interface). Add file-backed persistent state for `lastSessionId` + `nextAgent` + `nextModel`. OSS docs and CI.

**Tech Stack:** TypeScript 5.4, Node 20, `@opencode-ai/sdk` 1.14+, Telegraf v4, Vitest, zod.

**Reference:** `docs/superpowers/specs/2026-05-16-phase3-design.md` for design rationale.

---

## Task 1: Add types to core

**Files:**
- Create: `src/core/types.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/core/types.ts

export interface Card {
  title?: string
  lines: string[]
  buttons?: Button[][]
  footer?: string
}

export interface Button {
  label: string
  data: string
}

export interface IncomingMessage {
  userId: string
  chatId: string
  text: string
  messageId: string
}

export interface ChannelCapabilities {
  readonly edit: boolean
  readonly maxMessageLength: number
  readonly buttons: boolean
  readonly richText: boolean
  readonly streaming: boolean
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(core): add Card / Button / IncomingMessage / Capabilities types"
```

---

## Task 2: Define Transport interface

**Files:**
- Create: `src/transport/interface.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/transport/interface.ts

import type { Card, IncomingMessage, ChannelCapabilities } from '../core/types.js'

export interface Transport {
  readonly name: string
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
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/transport/interface.ts
git commit -m "feat(transport): define Transport interface"
```

---

## Task 3: Create SDK submit helper

**Files:**
- Create: `src/opencode/submit.ts`
- Create: `tests/unit/submit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/submit.test.ts
import { describe, it, expect, vi } from 'vitest'
import { submitPrompt } from '../../src/opencode/submit'

function fakeClient() {
  return {
    session: {
      prompt: vi.fn().mockResolvedValue({ data: {} }),
    },
  } as any
}

describe('submitPrompt', () => {
  it('passes text and sessionId to client.session.prompt', async () => {
    const client = fakeClient()
    await submitPrompt(client, { text: 'hello', sessionId: 'ses_1' })
    expect(client.session.prompt).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      body: { parts: [{ type: 'text', text: 'hello' }] },
      signal: undefined,
    })
  })

  it('includes agent override when provided', async () => {
    const client = fakeClient()
    await submitPrompt(client, { text: 'x', sessionId: 'ses_1', agent: 'build' })
    expect(client.session.prompt).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      body: { parts: [{ type: 'text', text: 'x' }], agent: 'build' },
      signal: undefined,
    })
  })

  it('includes model override when provided', async () => {
    const client = fakeClient()
    await submitPrompt(client, {
      text: 'x',
      sessionId: 'ses_1',
      model: { providerID: 'kimi-for-coding', modelID: 'k2p6' },
    })
    expect(client.session.prompt).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      body: {
        parts: [{ type: 'text', text: 'x' }],
        model: { providerID: 'kimi-for-coding', modelID: 'k2p6' },
      },
      signal: undefined,
    })
  })

  it('passes signal through', async () => {
    const client = fakeClient()
    const ac = new AbortController()
    await submitPrompt(client, { text: 'x', sessionId: 'ses_1', signal: ac.signal })
    expect(client.session.prompt).toHaveBeenCalledWith(expect.objectContaining({ signal: ac.signal }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/submit.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement submit.ts**

```typescript
// src/opencode/submit.ts
import type { OpencodeClient } from '@opencode-ai/sdk'

export interface SubmitOptions {
  text: string
  sessionId: string
  agent?: string
  model?: { providerID: string; modelID: string }
  signal?: AbortSignal
}

export async function submitPrompt(
  client: OpencodeClient,
  opts: SubmitOptions,
): Promise<void> {
  const body: Record<string, unknown> = {
    parts: [{ type: 'text', text: opts.text }],
  }
  if (opts.agent) body.agent = opts.agent
  if (opts.model) body.model = opts.model
  await client.session.prompt({
    path: { id: opts.sessionId },
    body,
    signal: opts.signal,
  } as any)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/submit.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/opencode/submit.ts tests/unit/submit.test.ts
git commit -m "feat(opencode): SDK-native submitPrompt with agent/model overrides"
```

---

## Task 4: Create persistent SessionState + AgentContext

**Files:**
- Create: `src/core/state.ts`
- Create: `tests/unit/state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/state.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileBackedState } from '../../src/core/state'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'state-test-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('SessionState', () => {
  it('returns undefined when no file exists', () => {
    const state = createFileBackedState(join(dir, 'state.json'))
    expect(state.getLastSessionId()).toBeUndefined()
    expect(state.getNextAgent()).toBeUndefined()
    expect(state.getNextModel()).toBeUndefined()
  })

  it('round-trips lastSessionId', async () => {
    const path = join(dir, 'state.json')
    const a = createFileBackedState(path)
    a.setLastSessionId('ses_1')
    await a.flush()
    const b = createFileBackedState(path)
    expect(b.getLastSessionId()).toBe('ses_1')
  })

  it('round-trips nextAgent + nextModel', async () => {
    const path = join(dir, 'state.json')
    const a = createFileBackedState(path)
    a.setNextAgent('build')
    a.setNextModel({ providerID: 'kimi-for-coding', modelID: 'k2p6' })
    await a.flush()
    const b = createFileBackedState(path)
    expect(b.getNextAgent()).toBe('build')
    expect(b.getNextModel()).toEqual({ providerID: 'kimi-for-coding', modelID: 'k2p6' })
  })

  it('recovers from malformed JSON by treating as empty', () => {
    const path = join(dir, 'state.json')
    writeFileSync(path, 'not json {{{')
    const state = createFileBackedState(path)
    expect(state.getLastSessionId()).toBeUndefined()
  })

  it('clears nextAgent when set to undefined', async () => {
    const path = join(dir, 'state.json')
    const a = createFileBackedState(path)
    a.setNextAgent('build')
    a.setNextAgent(undefined)
    await a.flush()
    const b = createFileBackedState(path)
    expect(b.getNextAgent()).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test → fail**

Run: `npx vitest run tests/unit/state.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement state.ts**

```typescript
// src/core/state.ts
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from '../utils/logger.js'

const log = createLogger('state')

interface PersistedState {
  lastSessionId?: string
  nextAgent?: string
  nextModel?: { providerID: string; modelID: string }
}

export interface SessionState {
  getLastSessionId(): string | undefined
  setLastSessionId(id: string | undefined): void
  getNextAgent(): string | undefined
  setNextAgent(name: string | undefined): void
  getNextModel(): { providerID: string; modelID: string } | undefined
  setNextModel(m: { providerID: string; modelID: string } | undefined): void
  flush(): Promise<void>
}

export function createFileBackedState(path: string): SessionState {
  let cache: PersistedState = load(path)
  let writeQueued: NodeJS.Timeout | undefined

  function persist(): Promise<void> {
    return new Promise((resolve) => {
      if (writeQueued) clearTimeout(writeQueued)
      writeQueued = setTimeout(() => {
        try {
          mkdirSync(dirname(path), { recursive: true })
          const tmp = `${path}.tmp`
          writeFileSync(tmp, JSON.stringify(cache, null, 2))
          renameSync(tmp, path)
        } catch (err) {
          log.warn('failed to persist state', (err as Error).message)
        }
        writeQueued = undefined
        resolve()
      }, 100)
    })
  }

  return {
    getLastSessionId: () => cache.lastSessionId,
    setLastSessionId: (id) => {
      if (id === undefined) delete cache.lastSessionId
      else cache.lastSessionId = id
      void persist()
    },
    getNextAgent: () => cache.nextAgent,
    setNextAgent: (name) => {
      if (name === undefined) delete cache.nextAgent
      else cache.nextAgent = name
      void persist()
    },
    getNextModel: () => cache.nextModel,
    setNextModel: (m) => {
      if (m === undefined) delete cache.nextModel
      else cache.nextModel = m
      void persist()
    },
    flush: async () => persist(),
  }
}

function load(path: string): PersistedState {
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw) as PersistedState
  } catch (err) {
    log.warn(`state file malformed, treating as empty: ${(err as Error).message}`)
    return {}
  }
}
```

- [ ] **Step 4: Run tests → pass**

Run: `npx vitest run tests/unit/state.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/state.ts tests/unit/state.test.ts
git commit -m "feat(core): file-backed SessionState with lastSessionId + nextAgent + nextModel"
```

---

## Task 5: Move bot/reply.ts to transport/telegram/

**Files:**
- Move: `src/bot/reply.ts` → `src/transport/telegram/reply-stream.ts`
- Update imports anywhere that references the old path

- [ ] **Step 1: Move the file with git**

```bash
mkdir -p src/transport/telegram
git mv src/bot/reply.ts src/transport/telegram/reply-stream.ts
```

- [ ] **Step 2: Update import in handlers/chat.ts (will be deleted later but keep build green for now)**

Run: `grep -rn "from.*bot/reply" src/`
Update each match to `from '../transport/telegram/reply-stream.js'` (adjust relative path).

- [ ] **Step 3: Verify build + tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean, 51 tests pass

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move bot/reply.ts to transport/telegram/reply-stream.ts"
```

---

## Task 6: Card render helpers for Telegram

**Files:**
- Create: `src/transport/telegram/render.ts`
- Create: `tests/unit/telegram-render.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/telegram-render.test.ts
import { describe, it, expect } from 'vitest'
import { cardToTelegram } from '../../src/transport/telegram/render'

describe('cardToTelegram', () => {
  it('renders title + lines', () => {
    const out = cardToTelegram({ title: '🤖 Agent', lines: ['build', 'plan'] })
    expect(out.text).toBe('<b>🤖 Agent</b>\n\nbuild\nplan')
    expect(out.options.parse_mode).toBe('HTML')
  })

  it('renders footer in italic', () => {
    const out = cardToTelegram({ title: 'T', lines: ['x'], footer: 'note' })
    expect(out.text).toBe('<b>T</b>\n\nx\n\n<i>note</i>')
  })

  it('renders 2D buttons as inline keyboard rows', () => {
    const out = cardToTelegram({
      lines: ['hi'],
      buttons: [
        [{ label: 'A', data: 'a' }, { label: 'B', data: 'b' }],
        [{ label: 'C', data: 'c' }],
      ],
    })
    const kb = (out.options.reply_markup as any).inline_keyboard
    expect(kb).toEqual([
      [{ text: 'A', callback_data: 'a' }, { text: 'B', callback_data: 'b' }],
      [{ text: 'C', callback_data: 'c' }],
    ])
  })

  it('omits keyboard when buttons absent', () => {
    const out = cardToTelegram({ lines: ['hi'] })
    expect(out.options.reply_markup).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test → fail**

Run: `npx vitest run tests/unit/telegram-render.test.ts`

- [ ] **Step 3: Implement render.ts**

```typescript
// src/transport/telegram/render.ts
import type { Card } from '../../core/types.js'

export function cardToTelegram(card: Card): {
  text: string
  options: {
    parse_mode: 'HTML'
    reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
  }
} {
  const lines: string[] = []
  if (card.title) {
    lines.push(`<b>${card.title}</b>`)
    lines.push('')
  }
  lines.push(...card.lines)
  if (card.footer) {
    lines.push('')
    lines.push(`<i>${card.footer}</i>`)
  }
  const options: any = { parse_mode: 'HTML' }
  if (card.buttons && card.buttons.length > 0) {
    options.reply_markup = {
      inline_keyboard: card.buttons.map((row) =>
        row.map((b) => ({ text: b.label, callback_data: b.data })),
      ),
    }
  }
  return { text: lines.join('\n'), options }
}
```

- [ ] **Step 4: Run tests → pass**

Run: `npx vitest run tests/unit/telegram-render.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/transport/telegram/render.ts tests/unit/telegram-render.test.ts
git commit -m "feat(transport/telegram): cardToTelegram render helper"
```

---

## Task 7: Create core/relay.ts

**Files:**
- Create: `src/core/relay.ts`
- Create: `tests/unit/relay.test.ts`

- [ ] **Step 1: Write failing test (FakeTransport + basic flow)**

```typescript
// tests/unit/relay.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRelay } from '../../src/core/relay'
import type { Transport } from '../../src/transport/interface'
import type { Card } from '../../src/core/types'

function fakeTransport(): Transport & { sent: Card[]; edits: Card[] } {
  const sent: Card[] = []
  const edits: Card[] = []
  const t = {
    name: 'fake',
    capabilities: {
      edit: true,
      maxMessageLength: 4000,
      buttons: true,
      richText: true,
      streaming: false,
    },
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(async (_c: string, card: Card) => {
      sent.push(card)
      return { messageId: `m${sent.length}` }
    }),
    edit: vi.fn(async (_c: string, _m: string, card: Card) => { edits.push(card) }),
    delete: vi.fn(),
    onMessage: vi.fn(),
    onCommand: vi.fn(),
    onButtonClick: vi.fn(),
    sent,
    edits,
  } as any
  return t
}

function fakeClient() {
  return {
    session: {
      prompt: vi.fn().mockResolvedValue({ data: {} }),
      list: vi.fn().mockResolvedValue({ data: [{ id: 'ses_test', time: { created: 1 } }] }),
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
  return {
    getLastSessionId: () => sid,
    setLastSessionId: (id: string | undefined) => { sid = id },
    getNextAgent: () => agent,
    setNextAgent: (n: string | undefined) => { agent = n },
    getNextModel: () => model,
    setNextModel: (m: any) => { model = m },
    flush: async () => {},
  } as any
}

describe('createRelay', () => {
  it('sends thinking card on incoming message', async () => {
    const transport = fakeTransport()
    const relay = createRelay({
      transport,
      client: fakeClient(),
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
      editThrottleMs: 1000,
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(transport.sent.length).toBeGreaterThan(0)
    expect(transport.sent[0].lines[0]).toMatch(/thinking/i)
  })

  it('calls session.prompt with the session id', async () => {
    const client = fakeClient()
    const relay = createRelay({
      transport: fakeTransport(),
      client,
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
      editThrottleMs: 1000,
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'ses_test' },
        body: expect.objectContaining({ parts: [{ type: 'text', text: 'hi' }] }),
      }),
    )
  })

  it('passes nextAgent and nextModel from state to session.prompt', async () => {
    const client = fakeClient()
    const state = fakeState()
    state.setNextAgent('build')
    state.setNextModel({ providerID: 'kimi-for-coding', modelID: 'k2p6' })
    const relay = createRelay({
      transport: fakeTransport(),
      client,
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state,
      editThrottleMs: 1000,
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent: 'build',
          model: { providerID: 'kimi-for-coding', modelID: 'k2p6' },
        }),
      }),
    )
  })

  it('mirrors prompt to TUI when tuiVisible=true', async () => {
    const client = fakeClient()
    const relay = createRelay({
      transport: fakeTransport(),
      client,
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
      editThrottleMs: 1000,
      chatTimeoutMs: 5000,
      tuiVisible: true,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.tui.appendPrompt).toHaveBeenCalledWith({ body: { text: 'hi' } })
  })

  it('does NOT call TUI when tuiVisible=false', async () => {
    const client = fakeClient()
    const relay = createRelay({
      transport: fakeTransport(),
      client,
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
      editThrottleMs: 1000,
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.tui.appendPrompt).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test → fail**

Run: `npx vitest run tests/unit/relay.test.ts`

- [ ] **Step 3: Implement relay.ts**

```typescript
// src/core/relay.ts
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { Transport } from '../transport/interface.js'
import type { Card, IncomingMessage } from './types.js'
import type { SessionState } from './state.js'
import type { EventStream } from '../opencode/event-stream.js'
import { submitPrompt } from '../opencode/submit.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('relay')

export interface RelayDeps {
  transport: Transport
  client: OpencodeClient
  eventStream: EventStream
  state: SessionState
  editThrottleMs: number
  chatTimeoutMs: number
  tuiVisible: boolean
}

function thinkingCard(): Card {
  return { lines: ['💭 thinking...'] }
}

function errorCard(msg: string): Card {
  return { lines: [`❌ ${msg}`] }
}

function textCard(text: string): Card {
  return { lines: [text] }
}

async function pickSession(client: OpencodeClient, last: string | undefined): Promise<string> {
  if (last) return last
  const res = await client.session.list()
  const sessions = (res.data ?? []) as Array<{ id: string; time?: { created?: number } }>
  if (sessions.length === 0) throw new Error('No opencode sessions found — open TUI first')
  const sorted = [...sessions].sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
  return sorted[0].id
}

export function createRelay(deps: RelayDeps) {
  return async function handleIncoming(msg: IncomingMessage): Promise<void> {
    const initial = await deps.transport.send(msg.chatId, thinkingCard())
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    try {
      const sessionId = await pickSession(deps.client, deps.state.getLastSessionId())
      deps.state.setLastSessionId(sessionId)

      // Optional TUI mirror (display only)
      if (deps.tuiVisible) {
        try {
          await deps.client.tui.appendPrompt({ body: { text: msg.text } } as any)
        } catch (err) {
          log.warn(`TUI mirror failed: ${(err as Error).message}`)
        }
      }

      // SDK-native submission with overrides
      await submitPrompt(deps.client, {
        text: msg.text,
        sessionId,
        agent: deps.state.getNextAgent(),
        model: deps.state.getNextModel(),
        signal: ac.signal,
      })

      // Iterate SSE for streaming output
      let assistantMessageId: string | undefined
      let streamedText = ''
      const textPartIds = new Set<string>()
      let lastEdit = 0

      for await (const ev of deps.eventStream.session(sessionId, ac.signal)) {
        const e = ev as { type: string; properties: any }
        const p = e.properties

        if (e.type === 'session.idle') break
        if (e.type === 'session.status' && p?.status?.type === 'idle') break
        if (e.type === 'session.error') {
          const err = p?.error
          const msg = err?.data?.message ?? err?.message ?? err?.name ?? 'session error'
          throw new Error(msg)
        }

        if (e.type === 'message.part.updated') {
          if (!assistantMessageId && typeof p?.messageID === 'string') {
            assistantMessageId = p.messageID
          }
          if (p?.part?.type === 'text' && typeof p.part.id === 'string') {
            textPartIds.add(p.part.id)
          }
        }

        if (e.type === 'message.part.delta') {
          if (!assistantMessageId && typeof p?.messageID === 'string') {
            assistantMessageId = p.messageID
          }
          const partId = p?.partID as string | undefined
          const field = p?.field as string | undefined
          const delta = p?.delta as string | undefined
          if (partId && textPartIds.has(partId) && field === 'text' && delta) {
            streamedText += delta
            const now = Date.now()
            if (deps.transport.capabilities.edit && now - lastEdit >= deps.editThrottleMs) {
              await deps.transport.edit(msg.chatId, initial.messageId, textCard(streamedText))
              lastEdit = now
            }
          }
        }
      }

      const final = streamedText || '(empty response)'
      await deps.transport.edit(msg.chatId, initial.messageId, textCard(final))
    } catch (err) {
      const e = err as Error
      log.warn('relay error', e.message)
      try {
        await deps.transport.edit(msg.chatId, initial.messageId, errorCard(e.message))
      } catch {}
    } finally {
      clearTimeout(timer)
    }
  }
}
```

- [ ] **Step 4: Run tests → pass**

Run: `npx vitest run tests/unit/relay.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/relay.ts tests/unit/relay.test.ts
git commit -m "feat(core): channel-agnostic relay using SDK session.prompt"
```

---

## Task 8: Update config.ts for TUI_VISIBLE + STATE_PATH

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add env vars to config schema**

In `src/config.ts`, add to the `z.object` schema:

```typescript
TUI_VISIBLE: z.string().optional().default('false').transform((v) => v === 'true'),
STATE_PATH: z.string().optional().default('./data/state.json'),
TRANSPORT: z.string().optional().default('telegram'),
```

Add to `Config` interface:

```typescript
tuiVisible: boolean
statePath: string
transport: string
```

Add to `loadConfig()` return:

```typescript
tuiVisible: parsed.TUI_VISIBLE,
statePath: parsed.STATE_PATH,
transport: parsed.TRANSPORT,
```

- [ ] **Step 2: Update .env.example**

Append:

```
# Mirror prompts into the opencode TUI's prompt buffer (display only)
TUI_VISIBLE=false

# Where persistent state is stored (lastSessionId, nextAgent, nextModel)
STATE_PATH=./data/state.json

# Active transport (telegram is the only one in v0.3)
TRANSPORT=telegram
```

- [ ] **Step 3: Verify TS + tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/config.ts .env.example
git commit -m "feat(config): TUI_VISIBLE, STATE_PATH, TRANSPORT env vars"
```

---

## Task 9: Implement Telegram transport (createTelegramTransport)

**Files:**
- Create: `src/transport/telegram/index.ts`
- Create: `src/transport/telegram/handlers.ts`
- Delete: `src/bot/handlers/chat.ts` (logic now in relay)

This is a large port. Approach:

- [ ] **Step 1: Create handlers.ts by merging current commands.ts + callbacks.ts**

Read `src/bot/handlers/commands.ts` and `src/bot/handlers/callbacks.ts`. Create `src/transport/telegram/handlers.ts` that registers all the same commands and callbacks but receives a `deps` object that includes `state: SessionState` instead of `getLastSessionId`/`setLastSessionId`.

Key changes from current code:
- `/agent` button label changes from "→ Next agent" to listing agents from `/config.agent`, with each agent tappable to set `state.setNextAgent(name)`.
- `/model` button: each model entry from `/config.agent.*.model` tappable; tapping sets `state.setNextAgent(ownerAgent)` AND `state.setNextModel({ providerID, modelID })`.
- `/session pin <id>` calls `client.tui.selectSession` if it exists, otherwise `POST /tui/select-session`.
- `/status` shows: opencode health, sessions/busy, pinned session, next-agent override, next-model override.
- All button callbacks read state via `deps.state`, not closures.

Write the handlers.ts file. (Code omitted from plan for brevity — port the existing logic adapting to `deps.state` and the new agent/model override semantics.)

- [ ] **Step 2: Create index.ts**

```typescript
// src/transport/telegram/index.ts
import { Telegraf, Markup } from 'telegraf'
import type { Context } from 'telegraf'
import type { Card, IncomingMessage } from '../../core/types.js'
import type { Transport, ChannelCapabilities } from '../interface.js'
import type { SessionState } from '../../core/state.js'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { EventStream } from '../../opencode/event-stream.js'
import { cardToTelegram } from './render.js'
import { registerHandlers } from './handlers.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('telegram')

export interface TelegramConfig {
  token: string
  allowedUserId: number
  baseUrl: string
  client: OpencodeClient
  eventStream: EventStream
  state: SessionState
}

const CAPS: ChannelCapabilities = {
  edit: true,
  maxMessageLength: 4000,
  buttons: true,
  richText: true,
  streaming: false,
}

export function createTelegramTransport(cfg: TelegramConfig): Transport {
  const bot = new Telegraf(cfg.token, { handlerTimeout: 600_000 })

  // Whitelist middleware
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== cfg.allowedUserId) {
      if (ctx.from) log.warn(`rejected from ${ctx.from.id}`)
      await ctx.reply('Unauthorized').catch(() => {})
      return
    }
    await next()
  })

  let messageHandler: ((msg: IncomingMessage) => Promise<void>) | undefined
  const commandHandlers = new Map<string, (msg: IncomingMessage) => Promise<void>>()
  let buttonHandler: ((data: string, msg: IncomingMessage) => Promise<void>) | undefined

  // Wire text handler
  bot.on('text', (ctx: Context) => {
    const m = ctx.message
    if (!m || !('text' in m)) return
    if (m.text.startsWith('/')) return  // commands handled separately
    if (!messageHandler) return
    const msg: IncomingMessage = {
      userId: String(ctx.from!.id),
      chatId: String(ctx.chat!.id),
      text: m.text,
      messageId: String(m.message_id),
    }
    void messageHandler(msg)
  })

  // Register commands + callbacks via handlers.ts
  registerHandlers({
    bot,
    client: cfg.client,
    baseUrl: cfg.baseUrl,
    state: cfg.state,
    onCommand: (name, h) => { commandHandlers.set(name, h) },
    onButtonClick: (h) => { buttonHandler = h },
  })

  return {
    name: 'telegram',
    capabilities: CAPS,
    async start() {
      let attempt = 0
      let conflictCount = 0
      const MAX_CONFLICT = 8
      for (;;) {
        try {
          await bot.launch()
          log.info('bot polling ended cleanly')
          return
        } catch (err) {
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
    async send(chatId, card) {
      const { text, options } = cardToTelegram(card)
      const sent = await bot.telegram.sendMessage(chatId, text, options as any)
      return { messageId: String(sent.message_id) }
    },
    async edit(chatId, messageId, card) {
      const { text, options } = cardToTelegram(card)
      try {
        await bot.telegram.editMessageText(chatId, Number(messageId), undefined, text, options as any)
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('message is not modified')) return
        log.warn('edit failed', msg)
      }
    },
    async delete(chatId, messageId) {
      try { await bot.telegram.deleteMessage(chatId, Number(messageId)) } catch {}
    },
    onMessage(h) { messageHandler = h },
    onCommand(name, h) { commandHandlers.set(name, h) },
    onButtonClick(h) { buttonHandler = h },
  }
}
```

- [ ] **Step 3: Update src/index.ts to wire it up**

```typescript
// src/index.ts (revised)
import 'dotenv/config'
import { loadConfig } from './config.js'
import { getClient, checkHealth } from './opencode/client.js'
import { EventStream } from './opencode/event-stream.js'
import { createFileBackedState } from './core/state.js'
import { createRelay } from './core/relay.js'
import { createTelegramTransport } from './transport/telegram/index.js'
import { createLogger } from './utils/logger.js'

const log = createLogger('main')

async function waitForHealth(baseUrl: string): Promise<void> {
  const RETRIES = 3
  const BACKOFF = [2000, 4000, 8000]
  for (let i = 0; i < RETRIES; i++) {
    if (await checkHealth(baseUrl)) {
      log.info(`opencode healthy at ${baseUrl}`)
      return
    }
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

  if (config.transport !== 'telegram') {
    throw new Error(`unsupported TRANSPORT: ${config.transport}`)
  }

  const transport = createTelegramTransport({
    token: config.telegramBotToken,
    allowedUserId: config.allowedUserId,
    baseUrl: config.opencodeBaseUrl,
    client,
    eventStream,
    state,
  })

  const relay = createRelay({
    transport,
    client,
    eventStream,
    state,
    editThrottleMs: config.editThrottleMs,
    chatTimeoutMs: config.chatTimeoutMs,
    tuiVisible: config.tuiVisible,
  })

  transport.onMessage(relay)

  process.once('SIGINT', () => { eventStream.stop(); void transport.stop() })
  process.once('SIGTERM', () => { eventStream.stop(); void transport.stop() })

  await transport.start()
}

if (process.argv[1]?.endsWith('index.js')) {
  runBot().catch((err) => {
    log.error('fatal', err as Error)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Delete obsolete bot/ files**

```bash
git rm -r src/bot/
```

- [ ] **Step 5: Verify TS + tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean (some old tests in `tests/unit/` that imported from `src/bot/` may need fixup or deletion; remove obsolete tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Telegram transport implements Transport interface; src/bot removed"
```

---

## Task 10: Verify end-to-end via live smoke test

- [ ] **Step 1: Build**

```bash
npm run build
```

- [ ] **Step 2: Start opencode serve (if not running)**

```bash
opencode serve --port 4096 &
```

- [ ] **Step 3: Start bot**

```bash
TUI_VISIBLE=false npm start
```

- [ ] **Step 4: Manual smoke checklist (record results)**

In Telegram:
- [ ] Send "hello" → assistant responds via stream
- [ ] `/status` → shows healthy + session count + lastSessionId
- [ ] `/agent` → lists 4 agents from `/config.agent`; tap "chat" → confirm card; send next message → response uses chat agent (verify via TUI or `/context` later)
- [ ] `/model` → lists 4 agent-pinned models; tap k2p6 → confirm card; next message uses build agent + k2p6
- [ ] `/sessions` → list
- [ ] `/files` → file ops
- [ ] `/abort` mid-message → stops
- [ ] Restart bot → `/status` still shows lastSessionId + next-agent override

- [ ] **Step 5: If TUI_VISIBLE=true, verify TUI mirror**

```bash
TUI_VISIBLE=true npm start
```

Send a message; verify it appears in TUI's prompt buffer.

- [ ] **Step 6: Commit + push if changes were made during smoke**

---

## Task 11: Stability — run 14.x acceptance tests

Per `2026-05-16-phase3-design.md` Section 7:

- [ ] **14.2 — concurrent busy**: send 2 messages back-to-back; second should get "⏳ session busy" not crash.
- [ ] **14.11 — network blip**: kill `opencode serve` mid-stream, restart 5s later; EventStream reconnect handles the gap.
- [ ] **14.12 — unauthorized user**: send from another Telegram account; bot ignores + logs.
- [ ] **14.13 — 24h soak**: leave bot running 24h; `cat /tmp/opencode-remote-control-telegram.err` shows no crash loops; `launchctl list | grep ai.opencode` exit count = 0.

Fix bugs encountered, commit fixes.

---

## Task 12: OSS prep — LICENSE + SECURITY.md

**Files:**
- Create: `LICENSE`
- Create: `SECURITY.md`

- [ ] **Step 1: Write LICENSE (MIT)**

```
MIT License

Copyright (c) 2026 <author handle from Appendix B>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Write SECURITY.md**

```markdown
# Security Policy

Report security issues privately to <security-email-from-Appendix-B>.
Please do not open public issues for security vulnerabilities.

## Response targets
- Acknowledge within 48 hours
- Patch high-severity issues within 14 days
- Patch other issues within 30 days

## Scope
This project is single-user-per-install. The bot's allowlist (`ALLOWED_USER_ID`)
is the primary boundary. Reports about bypassing the allowlist, exposing the
opencode HTTP server, or leaking the Telegram bot token are in scope.

Out of scope: anything in opencode itself — report those upstream.
```

- [ ] **Step 3: Commit**

```bash
git add LICENSE SECURITY.md
git commit -m "docs: add MIT LICENSE and SECURITY.md"
```

---

## Task 13: Rewrite README.md for public consumption

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Write README.md** following the structure from spec Section 8:

1. What it is (1 paragraph)
2. How we differ from grinev/openchamber/cc-connect (honest positioning)
3. Architecture (2-process model with diagram)
4. Quick Start (Telegram) — copy-paste commands
5. Running as a service (link OPS.md)
6. Command reference table
7. Multi-transport future (link ARCHITECTURE.md + CONTRIBUTING-NEW-TRANSPORT.md)
8. Security model
9. License: MIT

Full README content omitted from plan — implementer writes based on spec.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for public consumption"
```

---

## Task 14: docs/transports/telegram.md + CONTRIBUTING-NEW-TRANSPORT.md

**Files:**
- Create: `docs/transports/telegram.md`
- Create: `docs/transports/CONTRIBUTING-NEW-TRANSPORT.md`

- [ ] **Step 1: Write per-transport setup guide for Telegram**

Topics: BotFather flow, env vars, ALLOWED_USER_ID lookup, common errors (409 Conflict, "thinking..." stuck, allowlist), launchd setup.

- [ ] **Step 2: Write contributor guide for new transports**

Topics: implement Transport interface, declare capabilities, register in loader, test pattern, doc requirements.

- [ ] **Step 3: Commit**

```bash
git add docs/transports/
git commit -m "docs: per-transport setup + new-transport contributor guide"
```

---

## Task 15: GitHub Actions CI + issue/PR templates

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/ISSUE_TEMPLATE/bug.md`
- Create: `.github/ISSUE_TEMPLATE/feature.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 1: Write ci.yml**

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

- [ ] **Step 2: Write issue + PR templates** (standard boilerplate)

- [ ] **Step 3: Commit**

```bash
git add .github/
git commit -m "ci: GitHub Actions, issue templates, PR template"
```

---

## Task 16: Final audit + tag v0.3.0-rc.1

- [ ] **Step 1: Run full test + type-check**

```bash
npm test && npx tsc --noEmit
```

- [ ] **Step 2: Audit .env.example** — every var commented, no secrets.

- [ ] **Step 3: Update CHANGELOG.md** with v0.3.0-rc.1 entry.

- [ ] **Step 4: Update .agent/CURRENT.md and BACKLOG.md**

- [ ] **Step 5: Tag (DO NOT PUSH — user reviews first)**

```bash
git tag v0.3.0-rc.1
```

- [ ] **Step 6: Report back to user**

Summarize: tests passing, all DoD items checked, ready for review.

---

## Final acceptance checklist (per design spec Section 10)

- [ ] `npm test` passes (≥ 55 tests)
- [ ] `npx tsc --noEmit` clean
- [ ] `src/bot/` removed; replaced by `src/core/` + `src/transport/telegram/`
- [ ] Default submission via `session.prompt()`; TUI inject only when `TUI_VISIBLE=true`
- [ ] `/agent <name>` sets next-agent; verified by sending and observing agent in TUI/context
- [ ] `/model` sets next-model
- [ ] `lastSessionId`, `nextAgent`, `nextModel` survive restart
- [ ] 14.2 / 14.11 / 14.12 pass; 14.13 — 24h without crash-restart
- [ ] LICENSE, SECURITY.md, README, docs/ARCHITECTURE.md, docs/transports/* present
- [ ] CI green
- [ ] `.env.example` audited
- [ ] `git tag v0.3.0-rc.1` ready
