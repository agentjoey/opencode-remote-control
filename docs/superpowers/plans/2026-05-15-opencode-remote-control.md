# opencode-remote-control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a sidecar Telegram bot that relays messages to a running opencode TUI session, streams responses back, and surfaces tool-approval prompts as inline-keyboard buttons.

**Architecture:** Single Node 20 process. Connects to opencode HTTP server at `http://localhost:4096`. Submits user input via `POST /tui/submit-prompt`, captures the sessionID that goes busy via a `GET /session/status` diff, subscribes to `GET /event` SSE for streaming text and permission events. No PID lock / no watchdog — launchd handles process supervision.

**Tech Stack:** TypeScript 5.4, Node 20, Telegraf v4, `@opencode-ai/sdk` v1.14, Zod, Vitest, launchd.

**Repo:** `/Users/<you>/AgentWorks/Code_Opencode/opencode-remote-control/`

**Spec:** `docs/superpowers/specs/2026-05-15-opencode-remote-control-design.md`

---

## File Structure Recap

```
src/
├── index.ts                    # entry: load config → wire layers → bot.launch()
├── config.ts                   # Zod env schema
├── opencode/
│   ├── client.ts               # createOpencodeClient + health probe
│   ├── event-stream.ts         # SSE singleton, sessionID dispatch, auto-reconnect
│   └── tui-bridge.ts           # submit-prompt + session/status diff
├── bot/
│   ├── index.ts                # createBot(): owns lastSessionId state
│   ├── handlers/
│   │   ├── commands.ts         # /start /status /sessions /current /abort /help
│   │   ├── chat.ts             # text msg → submit → stream → reply
│   │   └── approval.ts         # permission.updated → InlineKeyboard
│   └── reply.ts                # createReplyStream() throttled editMessage + chunking
└── utils/
    ├── logger.ts               # ISO-timestamped stdout/stderr
    └── markdown.ts             # escapeMarkdownV2 + chunkMessage

tests/
├── unit/
│   ├── tui-bridge.test.ts
│   ├── event-stream.test.ts
│   └── reply.test.ts
└── integration/
    └── live-opencode.test.ts   # exercises real :4096

deploy/
└── ai.opencode.remote-control.telegram.plist
```

---

## Task 0: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore`, `README.md`

- [ ] **Step 0.1: Create `package.json`**

```json
{
  "name": "opencode-remote-control",
  "version": "0.1.0",
  "description": "Sidecar Telegram bot for remote-controlling a local opencode TUI session",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run tests/integration"
  },
  "dependencies": {
    "@opencode-ai/sdk": "^1.14.0",
    "dotenv": "^16.4.5",
    "telegraf": "^4.16.3",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.15.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 0.2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 0.3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    testTimeout: 10000,
    reporters: ['verbose'],
  },
})
```

- [ ] **Step 0.4: Create `.env.example`**

```env
# Telegram Bot Token from @BotFather (required)
TELEGRAM_BOT_TOKEN=

# Single allowed Telegram user ID (required)
ALLOWED_USER_ID=

# opencode server base URL (defaults to localhost:4096)
OPENCODE_BASE_URL=http://localhost:4096

# Stream edit throttle in ms (default 1000)
EDIT_THROTTLE_MS=1000

# Per-chat timeout in ms (default 120000)
CHAT_TIMEOUT_MS=120000

# Log level: debug | info | warn | error
LOG_LEVEL=info
```

- [ ] **Step 0.5: Create `.gitignore`**

```
node_modules/
dist/
.env
*.log
.DS_Store
.vitest-cache/
```

- [ ] **Step 0.6: Create `README.md`**

```markdown
# opencode-remote-control

Sidecar Telegram bot for remote-controlling a local opencode TUI session.

## Setup

1. Copy `.env.example` → `.env`, fill in `TELEGRAM_BOT_TOKEN` and `ALLOWED_USER_ID`.
2. `npm install`
3. `npm run build`
4. Ensure opencode TUI is running on `http://localhost:4096`.
5. `npm start` (or install as launchd service — see `deploy/`).

## Architecture

See `docs/superpowers/specs/2026-05-15-opencode-remote-control-design.md`.

## Test

```bash
npm test                  # unit tests
npm run test:integration  # contract tests against running opencode
```

## Deploy

```bash
cp deploy/ai.opencode.remote-control.telegram.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
launchctl start ai.opencode.remote-control.telegram
```
```

- [ ] **Step 0.7: Install dependencies**

Run:
```bash
cd /Users/<you>/AgentWorks/Code_Opencode/opencode-remote-control
npm install
```

Expected: `node_modules/` populated, no errors. `package-lock.json` created.

- [ ] **Step 0.8: Verify typecheck and test infra**

Run: `mkdir -p src tests/unit tests/integration && echo 'export {}' > src/index.ts && npx tsc --noEmit && npx vitest run --reporter=verbose`

Expected: typecheck passes (no errors); vitest reports "No test files found" — not an error, just nothing to run yet.

- [ ] **Step 0.9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .env.example .gitignore README.md package-lock.json src/index.ts
git commit -m "chore: project scaffold with TypeScript and Vitest"
```

---

## Task 1: Utility — `escapeMarkdownV2` and `chunkMessage`

**Files:**
- Create: `src/utils/markdown.ts`
- Test: `tests/unit/markdown.test.ts`

- [ ] **Step 1.1: Write failing test**

Create `tests/unit/markdown.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { escapeMarkdownV2, chunkMessage } from '../../src/utils/markdown'

describe('escapeMarkdownV2', () => {
  it('escapes all MarkdownV2 reserved characters', () => {
    const input = 'hello _*[]()~`>#+-=|{}.!\\world'
    const escaped = escapeMarkdownV2(input)
    // Every reserved char must be preceded by a backslash
    expect(escaped).toBe('hello \\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\world')
  })

  it('leaves regular text alone', () => {
    expect(escapeMarkdownV2('plain text 123')).toBe('plain text 123')
  })

  it('handles empty string', () => {
    expect(escapeMarkdownV2('')).toBe('')
  })
})

describe('chunkMessage', () => {
  it('returns single chunk when text fits', () => {
    expect(chunkMessage('short', 100)).toEqual(['short'])
  })

  it('splits on newlines preferentially', () => {
    const text = 'aaa\nbbb\nccc'
    const chunks = chunkMessage(text, 5)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toContain('aaa')
    expect(chunks.join('')).toContain('bbb')
    expect(chunks.join('')).toContain('ccc')
  })

  it('hard-splits a single line longer than maxLength', () => {
    const text = 'a'.repeat(15)
    const chunks = chunkMessage(text, 5)
    expect(chunks).toEqual(['aaaaa', 'aaaaa', 'aaaaa'])
  })

  it('uses default 4000 when maxLength omitted', () => {
    const text = 'x'.repeat(8000)
    const chunks = chunkMessage(text)
    expect(chunks.length).toBe(2)
    expect(chunks[0].length).toBe(4000)
  })
})
```

- [ ] **Step 1.2: Run test to confirm failure**

Run: `npx vitest run tests/unit/markdown.test.ts`

Expected: FAIL — `Cannot find module '../../src/utils/markdown'`

- [ ] **Step 1.3: Create implementation**

Create `src/utils/markdown.ts`:

```typescript
const MD_V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g

export function escapeMarkdownV2(text: string): string {
  return text.replace(MD_V2_SPECIAL, '\\$&')
}

export function chunkMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let current = ''

  for (const line of text.split('\n')) {
    // Hard-split lines longer than maxLength
    if (line.length > maxLength) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.slice(i, i + maxLength))
      }
      continue
    }

    const candidate = current ? current + '\n' + line : line
    if (candidate.length > maxLength) {
      chunks.push(current)
      current = line
    } else {
      current = candidate
    }
  }

  if (current) chunks.push(current)
  return chunks
}
```

- [ ] **Step 1.4: Run tests to confirm pass**

Run: `npx vitest run tests/unit/markdown.test.ts`

Expected: 7 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add src/utils/markdown.ts tests/unit/markdown.test.ts
git commit -m "feat(utils): add markdown escape and message chunking"
```

---

## Task 2: Utility — `logger`

**Files:**
- Create: `src/utils/logger.ts`

This is too simple to TDD (string formatting + console). Inline implementation, no test.

- [ ] **Step 2.1: Create `src/utils/logger.ts`**

```typescript
type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  return LEVELS[raw as Level] ?? LEVELS.info
}

function format(level: Level, mod: string, msg: string, extra: unknown[]): string {
  const ts = new Date().toISOString()
  const extras = extra.length
    ? ' ' + extra.map((e) => (e instanceof Error ? e.stack ?? e.message : JSON.stringify(e))).join(' ')
    : ''
  return `[${ts}] [${level.toUpperCase()}] [${mod}] ${msg}${extras}`
}

export function createLogger(mod: string) {
  return {
    debug: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.debug) console.log(format('debug', mod, msg, extra))
    },
    info: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.info) console.log(format('info', mod, msg, extra))
    },
    warn: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.warn) console.warn(format('warn', mod, msg, extra))
    },
    error: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.error) console.error(format('error', mod, msg, extra))
    },
  }
}
```

- [ ] **Step 2.2: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 2.3: Commit**

```bash
git add src/utils/logger.ts
git commit -m "feat(utils): add scoped logger"
```

---

## Task 3: Config Loading

**Files:**
- Create: `src/config.ts`
- Test: `tests/unit/config.test.ts`

- [ ] **Step 3.1: Write failing test**

Create `tests/unit/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../../src/config'

describe('loadConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.ALLOWED_USER_ID
    delete process.env.OPENCODE_BASE_URL
    delete process.env.EDIT_THROTTLE_MS
    delete process.env.CHAT_TIMEOUT_MS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('loads required fields and applies defaults', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.ALLOWED_USER_ID = '12345'

    const cfg = loadConfig()
    expect(cfg.telegramBotToken).toBe('tok')
    expect(cfg.allowedUserId).toBe(12345)
    expect(cfg.opencodeBaseUrl).toBe('http://localhost:4096')
    expect(cfg.editThrottleMs).toBe(1000)
    expect(cfg.chatTimeoutMs).toBe(120000)
  })

  it('throws when TELEGRAM_BOT_TOKEN missing', () => {
    process.env.ALLOWED_USER_ID = '12345'
    expect(() => loadConfig()).toThrow(/TELEGRAM_BOT_TOKEN/)
  })

  it('throws when ALLOWED_USER_ID is non-numeric', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.ALLOWED_USER_ID = 'abc'
    expect(() => loadConfig()).toThrow()
  })

  it('respects explicit env overrides', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.ALLOWED_USER_ID = '7'
    process.env.OPENCODE_BASE_URL = 'http://example:9000'
    process.env.EDIT_THROTTLE_MS = '500'
    process.env.CHAT_TIMEOUT_MS = '30000'

    const cfg = loadConfig()
    expect(cfg.opencodeBaseUrl).toBe('http://example:9000')
    expect(cfg.editThrottleMs).toBe(500)
    expect(cfg.chatTimeoutMs).toBe(30000)
  })
})
```

- [ ] **Step 3.2: Run test to confirm failure**

Run: `npx vitest run tests/unit/config.test.ts`

Expected: FAIL — `Cannot find module '../../src/config'`

- [ ] **Step 3.3: Create implementation**

Create `src/config.ts`:

```typescript
import { z } from 'zod'

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  ALLOWED_USER_ID: z.string().regex(/^\d+$/, 'ALLOWED_USER_ID must be a numeric Telegram user ID').transform(Number),
  OPENCODE_BASE_URL: z.string().url().default('http://localhost:4096'),
  EDIT_THROTTLE_MS: z.string().regex(/^\d+$/).default('1000').transform(Number),
  CHAT_TIMEOUT_MS: z.string().regex(/^\d+$/).default('120000').transform(Number),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export interface Config {
  telegramBotToken: string
  allowedUserId: number
  opencodeBaseUrl: string
  editThrottleMs: number
  chatTimeoutMs: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export function loadConfig(): Config {
  const parsed = schema.parse(process.env)
  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    allowedUserId: parsed.ALLOWED_USER_ID,
    opencodeBaseUrl: parsed.OPENCODE_BASE_URL,
    editThrottleMs: parsed.EDIT_THROTTLE_MS,
    chatTimeoutMs: parsed.CHAT_TIMEOUT_MS,
    logLevel: parsed.LOG_LEVEL,
  }
}
```

- [ ] **Step 3.4: Run tests to confirm pass**

Run: `npx vitest run tests/unit/config.test.ts`

Expected: 4 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat(config): add Zod env schema with defaults"
```

---

## Task 4: opencode Client + Health

**Files:**
- Create: `src/opencode/client.ts`
- Test: `tests/unit/opencode-client.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `tests/unit/opencode-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkHealth } from '../../src/opencode/client'

describe('checkHealth', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when /global/health returns healthy: true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ healthy: true, version: '1.14.50' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const ok = await checkHealth('http://localhost:4096')
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4096/global/health')
  })

  it('returns false when /global/health responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await checkHealth('http://localhost:4096')).toBe(false)
  })

  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('econnrefused')))
    expect(await checkHealth('http://localhost:4096')).toBe(false)
  })

  it('returns false when healthy flag is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.14.50' }),
    }))
    expect(await checkHealth('http://localhost:4096')).toBe(false)
  })
})
```

- [ ] **Step 4.2: Run test to confirm failure**

Run: `npx vitest run tests/unit/opencode-client.test.ts`

Expected: FAIL — `Cannot find module '../../src/opencode/client'`

- [ ] **Step 4.3: Create implementation**

Create `src/opencode/client.ts`:

```typescript
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk'

let _client: OpencodeClient | null = null

export function getClient(baseUrl: string): OpencodeClient {
  if (_client) return _client
  _client = createOpencodeClient({ baseUrl })
  return _client
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/global/health`)
    if (!res.ok) return false
    const data = (await res.json()) as { healthy?: boolean }
    return data.healthy === true
  } catch {
    return false
  }
}
```

- [ ] **Step 4.4: Run tests to confirm pass**

Run: `npx vitest run tests/unit/opencode-client.test.ts`

Expected: 4 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/opencode/client.ts tests/unit/opencode-client.test.ts
git commit -m "feat(opencode): add SDK client wrapper and health probe"
```

---

## Task 5: Event Stream — SSE Singleton

**Files:**
- Create: `src/opencode/event-stream.ts`
- Test: `tests/unit/event-stream.test.ts`

- [ ] **Step 5.1: Write failing test**

Create `tests/unit/event-stream.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { EventStream } from '../../src/opencode/event-stream'

// Fake AsyncIterable-yielding client
function fakeClient(events: unknown[]) {
  return {
    event: {
      subscribe: async () => ({
        stream: (async function* () {
          for (const e of events) yield e
        })(),
      }),
    },
  } as any
}

describe('EventStream', () => {
  it('extracts sessionID from properties.sessionID', () => {
    const es = new EventStream()
    const sid = (es as any).extractSessionID({
      type: 'session.idle',
      properties: { sessionID: 'ses_a' },
    })
    expect(sid).toBe('ses_a')
  })

  it('extracts sessionID from properties.part.sessionID (message.part.updated)', () => {
    const es = new EventStream()
    const sid = (es as any).extractSessionID({
      type: 'message.part.updated',
      properties: { part: { sessionID: 'ses_b' } },
    })
    expect(sid).toBe('ses_b')
  })

  it('extracts sessionID from properties.info.sessionID (message.updated)', () => {
    const es = new EventStream()
    const sid = (es as any).extractSessionID({
      type: 'message.updated',
      properties: { info: { sessionID: 'ses_c' } },
    })
    expect(sid).toBe('ses_c')
  })

  it('returns undefined when no sessionID can be found', () => {
    const es = new EventStream()
    expect((es as any).extractSessionID({ type: 'server.connected', properties: {} })).toBeUndefined()
  })

  it('session(id) yields only events for that sessionID', async () => {
    const es = new EventStream()
    const events = [
      { type: 'session.idle', properties: { sessionID: 'ses_a' } },
      { type: 'session.idle', properties: { sessionID: 'ses_b' } },
      { type: 'session.idle', properties: { sessionID: 'ses_a' } },
    ]
    es.start(fakeClient(events))

    const ac = new AbortController()
    const collected: any[] = []

    const consumer = (async () => {
      for await (const ev of es.session('ses_a', ac.signal)) {
        collected.push(ev)
        if (collected.length === 2) ac.abort()
      }
    })()

    await consumer
    expect(collected).toHaveLength(2)
    expect(collected.every((e) => e.properties.sessionID === 'ses_a')).toBe(true)
    es.stop()
  })

  it('onAny() receives every event', async () => {
    const es = new EventStream()
    const seen: string[] = []
    const off = es.onAny((e: any) => seen.push(e.type))
    es.start(fakeClient([
      { type: 'session.idle', properties: { sessionID: 'a' } },
      { type: 'permission.updated', properties: { id: 'p1', sessionID: 'a' } },
    ]))

    // Wait a tick for events to flow
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toContain('session.idle')
    expect(seen).toContain('permission.updated')
    off()
    es.stop()
  })

  it('stop() prevents further reconnection', async () => {
    const es = new EventStream()
    es.start(fakeClient([{ type: 'session.idle', properties: { sessionID: 'a' } }]))
    await new Promise((r) => setTimeout(r, 50))
    es.stop()
    expect((es as any).stopped).toBe(true)
  })
})
```

- [ ] **Step 5.2: Run test to confirm failure**

Run: `npx vitest run tests/unit/event-stream.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 5.3: Create implementation**

Create `src/opencode/event-stream.ts`:

```typescript
import { EventEmitter } from 'node:events'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { createLogger } from '../utils/logger.js'

const log = createLogger('event-stream')
const RECONNECT_MS = 3000
const MAX_CONSECUTIVE_FAILURES = 10

export class EventStream {
  private emitter = new EventEmitter()
  private stopped = false
  private consecutiveFailures = 0
  private running = false

  constructor() {
    // Bot will subscribe many session iterators; raise the cap.
    this.emitter.setMaxListeners(50)
  }

  private extractSessionID(event: any): string | undefined {
    const p = event?.properties
    if (!p) return undefined
    if (typeof p.sessionID === 'string') return p.sessionID
    if (p.part && typeof p.part.sessionID === 'string') return p.part.sessionID
    if (p.info && typeof p.info.sessionID === 'string') return p.info.sessionID
    return undefined
  }

  start(client: OpencodeClient): void {
    if (this.running || this.stopped) return
    this.running = true

    void (async () => {
      while (!this.stopped) {
        try {
          const { stream } = await client.event.subscribe()
          log.info('SSE connected')
          this.consecutiveFailures = 0
          for await (const event of stream) {
            if (this.stopped) break
            const sid = this.extractSessionID(event)
            if (sid) this.emitter.emit(sid, event)
            this.emitter.emit('*', event)
          }
          log.warn('SSE stream ended unexpectedly')
        } catch (err) {
          log.warn('SSE connection error', (err as Error).message)
        }

        if (this.stopped) break
        this.consecutiveFailures += 1
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          log.error(`SSE failed ${MAX_CONSECUTIVE_FAILURES} times in a row, exiting`)
          process.exit(1)
        }
        await new Promise((r) => setTimeout(r, RECONNECT_MS))
      }

      this.running = false
    })()
  }

  async *session(sessionId: string, signal: AbortSignal): AsyncGenerator<unknown> {
    const queue: unknown[] = []
    let wake: (() => void) | null = null

    const handler = (e: unknown) => {
      queue.push(e)
      wake?.()
      wake = null
    }
    this.emitter.on(sessionId, handler)

    const onAbort = () => {
      this.emitter.off(sessionId, handler)
      wake?.()
      wake = null
    }
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      while (!signal.aborted) {
        while (queue.length) yield queue.shift()
        if (signal.aborted) break
        await new Promise<void>((r) => { wake = r })
      }
    } finally {
      this.emitter.off(sessionId, handler)
      signal.removeEventListener('abort', onAbort)
    }
  }

  onAny(handler: (event: unknown) => void): () => void {
    this.emitter.on('*', handler)
    return () => this.emitter.off('*', handler)
  }

  stop(): void {
    this.stopped = true
    this.running = false
    this.emitter.removeAllListeners()
  }
}
```

- [ ] **Step 5.4: Run tests to confirm pass**

Run: `npx vitest run tests/unit/event-stream.test.ts`

Expected: 7 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/opencode/event-stream.ts tests/unit/event-stream.test.ts
git commit -m "feat(opencode): add SSE event stream with sessionID dispatch and auto-reconnect"
```

---

## Task 6: TUI Bridge — submit + status diff

**Files:**
- Create: `src/opencode/tui-bridge.ts`
- Test: `tests/unit/tui-bridge.test.ts`

- [ ] **Step 6.1: Write failing test**

Create `tests/unit/tui-bridge.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TuiBridge } from '../../src/opencode/tui-bridge'

describe('TuiBridge.submit', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function mockFetch(responses: Array<{ url: RegExp; body: any }>) {
    return vi.fn(async (url: string) => {
      const match = responses.shift()
      if (!match || !match.url.test(url)) {
        throw new Error(`Unexpected fetch to ${url}; remaining=${JSON.stringify(responses)}`)
      }
      return { ok: true, json: async () => match.body } as Response
    })
  }

  it('returns sessionID of newly busy session', async () => {
    const fetchMock = mockFetch([
      { url: /\/session\/status$/, body: {} }, // before: empty
      { url: /\/tui\/submit-prompt$/, body: true },
      { url: /\/session\/status$/, body: { ses_new: { type: 'busy' } } }, // after: new busy
    ])
    vi.stubGlobal('fetch', fetchMock)

    const bridge = new TuiBridge('http://localhost:4096')
    const sid = await bridge.submit('hello', { deadlineMs: 1000, intervalMs: 10 })
    expect(sid).toBe('ses_new')
  })

  it('skips sessions that were already busy before submit', async () => {
    const fetchMock = mockFetch([
      { url: /\/session\/status$/, body: { ses_old: { type: 'busy' } } }, // before
      { url: /\/tui\/submit-prompt$/, body: true },
      { url: /\/session\/status$/, body: { ses_old: { type: 'busy' }, ses_new: { type: 'busy' } } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const bridge = new TuiBridge('http://localhost:4096')
    const sid = await bridge.submit('hello', { deadlineMs: 1000, intervalMs: 10 })
    expect(sid).toBe('ses_new')
  })

  it('throws TuiBusyError when before-set is non-empty and no new session appears', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({ ses_old: { type: 'busy' } }) } as Response
      if (/\/tui\/submit-prompt$/.test(url)) return { ok: true, json: async () => true } as Response
      throw new Error('unexpected')
    })
    vi.stubGlobal('fetch', fetchMock)

    const bridge = new TuiBridge('http://localhost:4096')
    await expect(bridge.submit('hello', { deadlineMs: 100, intervalMs: 10 })).rejects.toMatchObject({
      reason: 'tui_busy',
    })
  })

  it('throws TuiNotRunningError when before-set is empty and no new session appears', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({}) } as Response
      if (/\/tui\/submit-prompt$/.test(url)) return { ok: true, json: async () => true } as Response
      throw new Error('unexpected')
    })
    vi.stubGlobal('fetch', fetchMock)

    const bridge = new TuiBridge('http://localhost:4096')
    await expect(bridge.submit('hello', { deadlineMs: 100, intervalMs: 10 })).rejects.toMatchObject({
      reason: 'tui_not_running',
    })
  })

  it('throws when /tui/submit-prompt does not return true', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({}) } as Response
      if (/\/tui\/submit-prompt$/.test(url)) return { ok: true, json: async () => false } as Response
      throw new Error('unexpected')
    })
    vi.stubGlobal('fetch', fetchMock)

    const bridge = new TuiBridge('http://localhost:4096')
    await expect(bridge.submit('hello', { deadlineMs: 100, intervalMs: 10 })).rejects.toThrow(/rejected/)
  })
})
```

- [ ] **Step 6.2: Run test to confirm failure**

Run: `npx vitest run tests/unit/tui-bridge.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 6.3: Create implementation**

Create `src/opencode/tui-bridge.ts`:

```typescript
import { createLogger } from '../utils/logger.js'

const log = createLogger('tui-bridge')

export type SubmitFailureReason = 'tui_not_running' | 'tui_busy' | 'submit_rejected'

export class TuiSubmitError extends Error {
  constructor(public reason: SubmitFailureReason, message: string) {
    super(message)
    this.name = 'TuiSubmitError'
  }
}

interface SubmitOptions {
  deadlineMs?: number
  intervalMs?: number
}

interface SessionStatus {
  [sessionId: string]: { type: string }
}

export class TuiBridge {
  constructor(private baseUrl: string) {}

  private async getStatus(): Promise<SessionStatus> {
    const res = await fetch(`${this.baseUrl}/session/status`)
    if (!res.ok) throw new Error(`/session/status HTTP ${res.status}`)
    return (await res.json()) as SessionStatus
  }

  async submit(text: string, opts: SubmitOptions = {}): Promise<string> {
    const deadlineMs = opts.deadlineMs ?? 5000
    const intervalMs = opts.intervalMs ?? 100

    // 1. Snapshot busy sessions BEFORE submit
    const beforeStatus = await this.getStatus()
    const before = new Set(
      Object.entries(beforeStatus)
        .filter(([, s]) => s.type === 'busy')
        .map(([id]) => id),
    )
    log.debug(`busy before submit: ${[...before].join(',') || '(none)'}`)

    // 2. POST /tui/submit-prompt
    const submitRes = await fetch(`${this.baseUrl}/tui/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!submitRes.ok) {
      throw new TuiSubmitError('submit_rejected', `/tui/submit-prompt HTTP ${submitRes.status}`)
    }
    const okBody = await submitRes.json()
    if (okBody !== true) {
      throw new TuiSubmitError('submit_rejected', `/tui/submit-prompt returned ${JSON.stringify(okBody)}, expected true`)
    }

    // 3. Poll /session/status for a NEWLY busy session
    const deadline = Date.now() + deadlineMs
    while (Date.now() < deadline) {
      const status = await this.getStatus()
      for (const [sid, s] of Object.entries(status)) {
        if (s.type === 'busy' && !before.has(sid)) {
          log.info(`captured session ${sid}`)
          return sid
        }
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }

    // 4. Differentiate: TUI not running vs TUI busy
    if (before.size === 0) {
      throw new TuiSubmitError(
        'tui_not_running',
        `No session went busy within ${deadlineMs}ms — is the opencode TUI running?`,
      )
    }
    throw new TuiSubmitError(
      'tui_busy',
      `TUI was already busy on session(s) ${[...before].join(',')}; new prompt was queued or ignored.`,
    )
  }
}
```

- [ ] **Step 6.4: Run tests to confirm pass**

Run: `npx vitest run tests/unit/tui-bridge.test.ts`

Expected: 5 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/opencode/tui-bridge.ts tests/unit/tui-bridge.test.ts
git commit -m "feat(opencode): add TUI bridge with submit-then-status-diff session capture"
```

---

## Task 7: Reply Stream — throttled edit + chunked finalize

**Files:**
- Create: `src/bot/reply.ts`
- Test: `tests/unit/reply.test.ts`

- [ ] **Step 7.1: Write failing test**

Create `tests/unit/reply.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReplyStream } from '../../src/bot/reply'

function fakeCtx() {
  return {
    chat: { id: 100 },
    telegram: {
      editMessageText: vi.fn().mockResolvedValue(true),
    },
    reply: vi.fn().mockResolvedValue({ message_id: 999 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
  }
}

describe('createReplyStream.update', () => {
  beforeEach(() => vi.useFakeTimers())

  it('first update edits the status message', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 4000 })
    await stream.update('partial 1')
    expect(ctx.telegram.editMessageText).toHaveBeenCalledTimes(1)
    expect(ctx.telegram.editMessageText).toHaveBeenCalledWith(100, 42, undefined, 'partial 1')
  })

  it('rejects updates within throttle window', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 4000 })
    await stream.update('a')
    await stream.update('b')
    await stream.update('c')
    expect(ctx.telegram.editMessageText).toHaveBeenCalledTimes(1)
  })

  it('accepts update after throttle expires', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 4000 })
    await stream.update('a')
    vi.advanceTimersByTime(1100)
    await stream.update('b')
    expect(ctx.telegram.editMessageText).toHaveBeenCalledTimes(2)
  })

  it('truncates body to 4000 chars in update (Telegram editMessage limit)', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 0, maxLength: 4000 })
    await stream.update('x'.repeat(5000))
    const args = ctx.telegram.editMessageText.mock.calls[0]
    expect((args[3] as string).length).toBe(4000)
  })

  it('swallows editMessage errors silently', async () => {
    const ctx = fakeCtx()
    ctx.telegram.editMessageText = vi.fn().mockRejectedValue(new Error('400'))
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 0, maxLength: 4000 })
    await expect(stream.update('boom')).resolves.toBeUndefined()
  })
})

describe('createReplyStream.finalize', () => {
  beforeEach(() => vi.useRealTimers())

  it('deletes status then sends single reply when short', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 4000 })
    await stream.finalize('final short text')
    expect(ctx.deleteMessage).toHaveBeenCalledWith(42)
    expect(ctx.reply).toHaveBeenCalledTimes(1)
    expect(ctx.reply).toHaveBeenCalledWith('final short text')
  })

  it('chunks long output into multiple replies', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 5 })
    await stream.finalize('aaaaa\nbbbbb\nccccc')
    expect(ctx.reply.mock.calls.length).toBeGreaterThan(1)
  })

  it('replies "(empty response)" when text is blank', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 4000 })
    await stream.finalize('')
    expect(ctx.reply).toHaveBeenCalledWith('(empty response)')
  })
})
```

- [ ] **Step 7.2: Run test to confirm failure**

Run: `npx vitest run tests/unit/reply.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 7.3: Create implementation**

Create `src/bot/reply.ts`:

```typescript
import type { Context } from 'telegraf'
import { chunkMessage } from '../utils/markdown.js'

interface ReplyStreamOpts {
  throttleMs: number
  maxLength: number
}

export interface ReplyStream {
  update(text: string): Promise<void>
  finalize(text: string): Promise<void>
}

export function createReplyStream(
  ctx: Context,
  messageId: number,
  opts: ReplyStreamOpts,
): ReplyStream {
  let lastEditAt = 0
  const EDIT_HARD_LIMIT = 4000 // Telegram editMessageText body limit (4096; leave headroom)

  return {
    async update(text: string): Promise<void> {
      const now = Date.now()
      if (now - lastEditAt < opts.throttleMs) return
      lastEditAt = now
      const body = text.length > EDIT_HARD_LIMIT ? text.slice(0, EDIT_HARD_LIMIT) : text
      try {
        await ctx.telegram.editMessageText(ctx.chat!.id, messageId, undefined, body)
      } catch {
        // 400 (same content / deleted) and 429 (rate limit) are non-fatal
      }
    },

    async finalize(text: string): Promise<void> {
      try {
        await ctx.deleteMessage(messageId)
      } catch {
        // Status message may already be gone
      }
      const body = text || '(empty response)'
      for (const chunk of chunkMessage(body, opts.maxLength)) {
        await ctx.reply(chunk)
      }
    },
  }
}
```

- [ ] **Step 7.4: Run tests to confirm pass**

Run: `npx vitest run tests/unit/reply.test.ts`

Expected: 8 tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/bot/reply.ts tests/unit/reply.test.ts
git commit -m "feat(bot): add throttled reply stream with chunked finalize"
```

---

## Task 8: Chat Handler

**Files:**
- Create: `src/bot/handlers/chat.ts`

Chat handler integrates many parts; the integration test is in Task 12 (live opencode). Here we add the unit-level wiring only; behavior is exercised end-to-end later.

- [ ] **Step 8.1: Create implementation**

Create `src/bot/handlers/chat.ts`:

```typescript
import type { Context } from 'telegraf'
import type { Message } from 'telegraf/typings/core/types/typegram.js'
import { TuiBridge, TuiSubmitError } from '../../opencode/tui-bridge.js'
import { EventStream } from '../../opencode/event-stream.js'
import { createReplyStream } from '../reply.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('chat')

interface ChatDeps {
  tuiBridge: TuiBridge
  eventStream: EventStream
  editThrottleMs: number
  chatTimeoutMs: number
  setLastSessionId: (id: string) => void
}

export function createChatHandler(deps: ChatDeps) {
  return async function handleChat(ctx: Context, text: string): Promise<void> {
    const statusMsg = (await ctx.reply('💭 thinking...')) as Message.TextMessage
    const replyStream = createReplyStream(ctx, statusMsg.message_id, {
      throttleMs: deps.editThrottleMs,
      maxLength: 4000,
    })

    const typingInterval = setInterval(() => {
      ctx.sendChatAction('typing').catch(() => {})
    }, 4000)

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    let sessionId: string | undefined
    let fullText = ''

    try {
      sessionId = await deps.tuiBridge.submit(text)
      deps.setLastSessionId(sessionId)

      for await (const ev of deps.eventStream.session(sessionId, ac.signal)) {
        const e = ev as { type: string; properties: any }

        if (e.type === 'session.idle') break
        if (e.type === 'session.error') {
          const errMsg = e.properties?.error?.message ?? 'opencode reported a session error'
          throw new Error(errMsg)
        }
        if (e.type === 'message.part.updated') {
          const part = e.properties?.part
          if (part?.type === 'text') {
            // Assistant text only; user echo also has part.type === 'text' but a different role
            // Distinguish by part.messageID -> not 100% reliable here; rely on a heuristic:
            // assistant part deltas typically grow text/delta — we just track the latest non-empty text
            if (typeof part.text === 'string' && part.text.length > 0) {
              fullText = part.text
            } else if (typeof e.properties.delta === 'string') {
              fullText += e.properties.delta
            }
            await replyStream.update(fullText)
          }
        }
      }

      if (ac.signal.aborted) throw new Error('timeout')
      await replyStream.finalize(fullText)
    } catch (err) {
      const errAny = err as Error
      if (errAny instanceof TuiSubmitError) {
        const msg =
          errAny.reason === 'tui_not_running'
            ? '❌ TUI not running. Please start opencode TUI on your Mac.'
            : errAny.reason === 'tui_busy'
            ? '⏳ TUI is busy. Wait for the current response to finish or /abort it.'
            : `❌ ${errAny.message}`
        try { await ctx.deleteMessage(statusMsg.message_id) } catch {}
        await ctx.reply(msg)
      } else if (errAny.message === 'timeout') {
        try { await ctx.deleteMessage(statusMsg.message_id) } catch {}
        await ctx.reply(`⏱ Request timed out (${deps.chatTimeoutMs}ms). Try /abort then resend.`)
      } else {
        log.error('chat handler failed', errAny)
        try { await ctx.deleteMessage(statusMsg.message_id) } catch {}
        await ctx.reply(`❌ ${errAny.message}`)
      }
    } finally {
      clearTimeout(timer)
      clearInterval(typingInterval)
    }
  }
}
```

- [ ] **Step 8.2: Typecheck**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 8.3: Commit**

```bash
git add src/bot/handlers/chat.ts
git commit -m "feat(bot): add chat handler with streaming and error routing"
```

---

## Task 9: Approval Handler

**Files:**
- Create: `src/bot/handlers/approval.ts`

- [ ] **Step 9.1: Create implementation**

Create `src/bot/handlers/approval.ts`:

```typescript
import type { Telegraf } from 'telegraf'
import { Markup } from 'telegraf'
import { EventStream } from '../../opencode/event-stream.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('approval')

interface PendingApproval {
  sessionId: string
  permissionId: string
  messageId: number
  title: string
}

interface ApprovalDeps {
  bot: Telegraf
  eventStream: EventStream
  baseUrl: string
  chatId: number
}

type ApprovalResponse = 'once' | 'always' | 'reject'

export function setupApprovalHandler(deps: ApprovalDeps): () => void {
  const pending = new Map<string, PendingApproval>()

  // Listen for permission.updated → push card
  const offUpdated = deps.eventStream.onAny(async (rawEvent: unknown) => {
    const ev = rawEvent as { type: string; properties: any }
    if (ev.type !== 'permission.updated') return

    const permId = ev.properties?.id as string | undefined
    const title = (ev.properties?.title as string | undefined) ?? 'Unknown operation'
    const sessionId = ev.properties?.sessionID as string | undefined
    if (!permId || !sessionId) {
      log.warn('permission.updated missing id or sessionID', ev.properties)
      return
    }

    const text = `🔐 Approval Required\n\n${title}`
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Allow Once', `approve:once:${permId}`),
        Markup.button.callback('🔓 Always', `approve:always:${permId}`),
      ],
      [Markup.button.callback('❌ Reject', `approve:reject:${permId}`)],
    ])

    try {
      const msg = await deps.bot.telegram.sendMessage(deps.chatId, text, keyboard)
      pending.set(permId, {
        sessionId,
        permissionId: permId,
        messageId: msg.message_id,
        title,
      })
      log.info(`approval card sent permId=${permId}`)
    } catch (err) {
      log.error('failed to send approval card', err as Error)
    }
  })

  // Telegram button click → POST reply to opencode
  deps.bot.action(/^approve:(once|always|reject):(.+)$/, async (ctx) => {
    const match = ctx.match as RegExpMatchArray
    const response = match[1] as ApprovalResponse
    const permId = match[2]
    const p = pending.get(permId)

    if (!p) {
      await ctx.answerCbQuery('This request has already been handled.')
      return
    }

    try {
      const res = await fetch(`${deps.baseUrl}/permission/${permId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      log.error(`failed to reply permission ${permId}`, err as Error)
      await ctx.answerCbQuery('Failed to reply. The request may have expired.')
      return
    }

    pending.delete(permId)

    const labels: Record<ApprovalResponse, string> = {
      once: '✅ Allowed (once)',
      always: '🔓 Always Allowed',
      reject: '❌ Rejected',
    }
    const display = labels[response]
    await ctx.editMessageText(`${display}\n\n${p.title}`).catch(() => {})
    await ctx.answerCbQuery(display)
  })

  // Mirror: TUI replied locally → update the Telegram card
  const offReplied = deps.eventStream.onAny(async (rawEvent: unknown) => {
    const ev = rawEvent as { type: string; properties: any }
    if (ev.type !== 'permission.replied') return

    const permId = ev.properties?.permissionID as string | undefined
    const response = ev.properties?.response as string | undefined
    if (!permId) return

    const p = pending.get(permId)
    if (!p) return

    pending.delete(permId)
    try {
      await deps.bot.telegram.editMessageText(
        deps.chatId,
        p.messageId,
        undefined,
        `${labelFor(response)} (from TUI)\n\n${p.title}`,
      )
    } catch (err) {
      log.warn(`couldn't update card after TUI reply: ${(err as Error).message}`)
    }
  })

  return () => {
    offUpdated()
    offReplied()
  }
}

function labelFor(response?: string): string {
  switch (response) {
    case 'once':   return '✅ Allowed (once)'
    case 'always': return '🔓 Always Allowed'
    case 'reject': return '❌ Rejected'
    default:       return response ?? 'Handled'
  }
}
```

- [ ] **Step 9.2: Typecheck**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 9.3: Commit**

```bash
git add src/bot/handlers/approval.ts
git commit -m "feat(bot): add bidirectional approval handler with TUI mirror"
```

---

## Task 10: Commands Handler

**Files:**
- Create: `src/bot/handlers/commands.ts`

- [ ] **Step 10.1: Create implementation**

Create `src/bot/handlers/commands.ts`:

```typescript
import type { Telegraf } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { checkHealth } from '../../opencode/client.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('commands')

interface CommandsDeps {
  bot: Telegraf
  client: OpencodeClient
  baseUrl: string
  getLastSessionId: () => string | undefined
}

export function registerCommands(deps: CommandsDeps): void {
  deps.bot.command('start', async (ctx) => {
    const healthy = await checkHealth(deps.baseUrl)
    const username = ctx.from?.first_name ?? 'there'
    const lines = [
      `👋 Hi ${username}!`,
      '',
      'I relay your messages to your local opencode TUI session.',
      '',
      `opencode server: ${healthy ? '✅ healthy' : '❌ unreachable'}`,
      '',
      'Send any text to chat. Commands:',
      '/status — server + last session',
      '/sessions — list all sessions',
      '/current — last session this bot used',
      '/abort — stop the current generation',
      '/help — this message',
    ]
    await ctx.reply(lines.join('\n'))
  })

  deps.bot.command('status', async (ctx) => {
    const healthy = await checkHealth(deps.baseUrl)
    let busyCount = 0
    try {
      const res = await fetch(`${deps.baseUrl}/session/status`)
      const data = (await res.json()) as Record<string, { type: string }>
      busyCount = Object.values(data).filter((s) => s.type === 'busy').length
    } catch {
      // ignore
    }
    const last = deps.getLastSessionId()
    await ctx.reply(
      [
        `opencode: ${healthy ? '✅ healthy' : '❌ unreachable'}`,
        `busy sessions: ${busyCount}`,
        `last bot session: ${last ?? '(none yet)'}`,
      ].join('\n'),
    )
  })

  deps.bot.command('sessions', async (ctx) => {
    try {
      const result = await deps.client.session.list()
      const sessions = (result.data ?? []) as Array<{ id: string; title?: string; time?: { created?: number } }>
      if (sessions.length === 0) {
        await ctx.reply('No sessions.')
        return
      }
      const lines: string[] = ['📋 Sessions:', '']
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i]
        const when = s.time?.created
          ? new Date(s.time.created).toLocaleString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })
          : 'unknown'
        lines.push(`${i + 1}. ${s.id}`)
        lines.push(`   ${s.title ?? 'Untitled'} · ${when}`)
        lines.push('')
      }
      await ctx.reply(lines.join('\n'))
    } catch (err) {
      log.error('failed to list sessions', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`)
    }
  })

  deps.bot.command('current', async (ctx) => {
    const last = deps.getLastSessionId()
    if (!last) {
      await ctx.reply('No session used yet. Send a message to start one via the TUI.')
      return
    }
    await ctx.reply(`Last bot session: ${last}`)
  })

  deps.bot.command('abort', async (ctx) => {
    const last = deps.getLastSessionId()
    if (!last) {
      await ctx.reply('No session to abort.')
      return
    }
    try {
      const res = await fetch(`${deps.baseUrl}/session/${last}/abort`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await ctx.reply(`🛑 Aborted ${last}`)
    } catch (err) {
      await ctx.reply(`❌ Abort failed: ${(err as Error).message}`)
    }
  })

  deps.bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        'Commands:',
        '/start — handshake + health',
        '/status — server status + last session',
        '/sessions — list all opencode sessions',
        '/current — last session this bot used',
        '/abort — stop the current generation',
        '/help — this message',
        '',
        'Send any text to relay it into the TUI prompt.',
      ].join('\n'),
    )
  })

  deps.bot.telegram
    .setMyCommands([
      { command: 'start', description: 'Handshake and health' },
      { command: 'status', description: 'Server + last session' },
      { command: 'sessions', description: 'List all sessions' },
      { command: 'current', description: 'Last session used' },
      { command: 'abort', description: 'Stop the current generation' },
      { command: 'help', description: 'Show help' },
    ])
    .catch((err) => log.warn('setMyCommands failed', err))
}
```

- [ ] **Step 10.2: Typecheck**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 10.3: Commit**

```bash
git add src/bot/handlers/commands.ts
git commit -m "feat(bot): add slash command handlers"
```

---

## Task 11: Bot Wiring + Entry Point

**Files:**
- Create: `src/bot/index.ts`, `src/index.ts`

- [ ] **Step 11.1: Create `src/bot/index.ts`**

```typescript
import { Telegraf } from 'telegraf'
import type { Context } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { Config } from '../config.js'
import { TuiBridge } from '../opencode/tui-bridge.js'
import { EventStream } from '../opencode/event-stream.js'
import { createChatHandler } from './handlers/chat.js'
import { setupApprovalHandler } from './handlers/approval.js'
import { registerCommands } from './handlers/commands.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('bot')

interface BotDeps {
  config: Config
  client: OpencodeClient
  eventStream: EventStream
}

export function createBot(deps: BotDeps): Telegraf {
  const bot = new Telegraf(deps.config.telegramBotToken, {
    handlerTimeout: 600_000,
  })

  let lastSessionId: string | undefined

  // Whitelist middleware
  bot.use(async (ctx, next) => {
    const fromId = ctx.from?.id
    if (fromId !== deps.config.allowedUserId) {
      if (fromId) log.warn(`rejected message from user ${fromId}`)
      await ctx.reply('Unauthorized').catch(() => {})
      return
    }
    await next()
  })

  // Commands
  registerCommands({
    bot,
    client: deps.client,
    baseUrl: deps.config.opencodeBaseUrl,
    getLastSessionId: () => lastSessionId,
  })

  // Chat handler
  const tuiBridge = new TuiBridge(deps.config.opencodeBaseUrl)
  const handleChat = createChatHandler({
    tuiBridge,
    eventStream: deps.eventStream,
    editThrottleMs: deps.config.editThrottleMs,
    chatTimeoutMs: deps.config.chatTimeoutMs,
    setLastSessionId: (id) => { lastSessionId = id },
  })

  bot.on('text', async (ctx: Context) => {
    const message = ctx.message
    if (!message || !('text' in message)) return
    if (message.text.startsWith('/')) return
    await handleChat(ctx, message.text)
  })

  // Approval handler
  setupApprovalHandler({
    bot,
    eventStream: deps.eventStream,
    baseUrl: deps.config.opencodeBaseUrl,
    chatId: deps.config.allowedUserId,
  })

  // Error catch-all
  bot.catch((err, ctx) => {
    log.error('telegraf catch-all', err as Error)
    ctx.reply(`Internal error: ${(err as Error).message}`).catch(() => {})
  })

  return bot
}
```

- [ ] **Step 11.2: Create `src/index.ts`**

Replace the placeholder at `src/index.ts`:

```typescript
import 'dotenv/config'
import { loadConfig } from './config.js'
import { getClient, checkHealth } from './opencode/client.js'
import { EventStream } from './opencode/event-stream.js'
import { createBot } from './bot/index.js'
import { createLogger } from './utils/logger.js'

const log = createLogger('main')

const HEALTH_RETRIES = 3
const HEALTH_BACKOFF_MS = [2000, 4000, 8000]

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let i = 0; i < HEALTH_RETRIES; i++) {
    if (await checkHealth(baseUrl)) {
      log.info(`opencode healthy at ${baseUrl}`)
      return
    }
    log.warn(`opencode unhealthy (attempt ${i + 1}/${HEALTH_RETRIES}), retry in ${HEALTH_BACKOFF_MS[i]}ms`)
    await new Promise((r) => setTimeout(r, HEALTH_BACKOFF_MS[i]))
  }
  throw new Error(`opencode failed health check at ${baseUrl} after ${HEALTH_RETRIES} attempts`)
}

async function main() {
  const config = loadConfig()
  log.info(`starting bot, opencode=${config.opencodeBaseUrl}, allowedUser=${config.allowedUserId}`)

  await waitForHealth(config.opencodeBaseUrl)

  const client = getClient(config.opencodeBaseUrl)
  const eventStream = new EventStream()
  eventStream.start(client) // fire-and-forget; loop runs in background

  const bot = createBot({ config, client, eventStream })

  process.once('SIGINT', () => {
    log.info('SIGINT received')
    eventStream.stop()
    bot.stop('SIGINT')
  })
  process.once('SIGTERM', () => {
    log.info('SIGTERM received')
    eventStream.stop()
    bot.stop('SIGTERM')
  })

  // Polling with retry — keep alive on network blips
  let attempt = 0
  let conflictCount = 0
  const MAX_CONFLICT = 8
  for (;;) {
    try {
      await bot.launch()
      // bot.launch() resolves when polling stops (e.g. on bot.stop())
      log.info('bot polling ended cleanly')
      return
    } catch (err) {
      const e = err as { response?: { error_code?: number }; message?: string }
      const code = e?.response?.error_code
      if (code === 409) {
        conflictCount += 1
        if (conflictCount >= MAX_CONFLICT) {
          log.error('Telegram 409 Conflict persisted — exiting')
          process.exit(1)
        }
        log.warn(`Telegram 409 #${conflictCount}, retry in 5s`)
        await new Promise((r) => setTimeout(r, 5000))
      } else {
        attempt += 1
        const delay = Math.min(1000 * 2 ** attempt, 30000)
        log.error(`bot.launch failed (attempt ${attempt}), retry in ${delay}ms`, e?.message ?? err)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
}

main().catch((err) => {
  log.error('fatal', err as Error)
  process.exit(1)
})
```

- [ ] **Step 11.3: Build the project**

Run: `npx tsc`

Expected: `dist/` populated with .js files, no errors.

- [ ] **Step 11.4: Run all unit tests**

Run: `npm test`

Expected: all unit tests pass (markdown + config + opencode-client + event-stream + tui-bridge + reply ≈ 35+ tests).

- [ ] **Step 11.5: Commit**

```bash
git add src/bot/index.ts src/index.ts
git commit -m "feat: wire bot, entry point, polling retry"
```

---

## Task 12: Live Integration Test (manual / pre-release)

**Files:**
- Create: `tests/integration/live-opencode.test.ts`

Requires real opencode TUI running on `localhost:4096` before invoking. Excluded from `npm test`; run via `npm run test:integration`.

- [ ] **Step 12.1: Create live integration test**

Create `tests/integration/live-opencode.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { checkHealth, getClient } from '../../src/opencode/client'
import { TuiBridge } from '../../src/opencode/tui-bridge'
import { EventStream } from '../../src/opencode/event-stream'

const BASE_URL = process.env.OPENCODE_BASE_URL ?? 'http://localhost:4096'

describe('live opencode integration (requires TUI running)', () => {
  beforeAll(async () => {
    const healthy = await checkHealth(BASE_URL)
    if (!healthy) {
      throw new Error(`opencode not healthy at ${BASE_URL} — start TUI first`)
    }
  })

  it('GET /session/status returns an object', async () => {
    const res = await fetch(`${BASE_URL}/session/status`)
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(typeof data).toBe('object')
  })

  it('TuiBridge.submit captures a session and SSE delivers session.idle', async () => {
    const bridge = new TuiBridge(BASE_URL)
    const stream = new EventStream()
    stream.start(getClient(BASE_URL))

    let sessionId: string
    try {
      sessionId = await bridge.submit('Reply with exactly the word "pong".', {
        deadlineMs: 10000,
        intervalMs: 200,
      })
    } catch (err) {
      stream.stop()
      throw err
    }
    expect(sessionId).toMatch(/^ses_/)

    const ac = new AbortController()
    setTimeout(() => ac.abort(), 60_000) // generous: real LLM can be slow

    let sawText = false
    let sawIdle = false
    for await (const ev of stream.session(sessionId, ac.signal)) {
      const e = ev as { type: string; properties: any }
      if (e.type === 'message.part.updated' && e.properties.part?.type === 'text') sawText = true
      if (e.type === 'session.idle') { sawIdle = true; break }
    }
    stream.stop()
    expect(sawText).toBe(true)
    expect(sawIdle).toBe(true)
  }, 90_000)
})
```

- [ ] **Step 12.2: Run integration test**

Ensure opencode TUI is running on `:4096`, then run:

```bash
npm run test:integration
```

Expected: both tests pass; second one takes ~10-30s depending on LLM speed.

- [ ] **Step 12.3: Commit**

```bash
git add tests/integration/live-opencode.test.ts
git commit -m "test: add live opencode integration tests"
```

---

## Task 13: launchd Deployment

**Files:**
- Create: `deploy/ai.opencode.remote-control.telegram.plist`

- [ ] **Step 13.1: Resolve absolute paths**

Run: `which node`

Expected: an absolute path, e.g. `/usr/local/bin/node` or `/opt/homebrew/bin/node`. **Note this path** for the plist below.

- [ ] **Step 13.2: Create plist (replace `__NODE_BIN__` with the path from 13.1)**

Create `deploy/ai.opencode.remote-control.telegram.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
                       "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.opencode.remote-control.telegram</string>

  <key>WorkingDirectory</key>
  <string>/Users/<you>/AgentWorks/Code_Opencode/opencode-remote-control</string>

  <key>ProgramArguments</key>
  <array>
    <string>__NODE_BIN__</string>
    <string>dist/index.js</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>

  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>

  <key>StandardOutPath</key>
  <string>/tmp/opencode-remote-control-telegram.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/opencode-remote-control-telegram.err</string>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
```

> The plist does NOT carry secrets. `TELEGRAM_BOT_TOKEN` and `ALLOWED_USER_ID` are loaded from `.env` in the WorkingDirectory via `dotenv/config` in `src/index.ts`.

- [ ] **Step 13.3: Install and load**

Run:

```bash
cp deploy/ai.opencode.remote-control.telegram.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
launchctl start ai.opencode.remote-control.telegram
```

- [ ] **Step 13.4: Verify it's running**

Run:

```bash
launchctl list | grep ai.opencode.remote-control.telegram
# Expected: a line showing PID > 0 and exit code 0 (or "-" if just started)

tail -f /tmp/opencode-remote-control-telegram.log
# Expected: log lines showing "starting bot", "opencode healthy", "SSE connected"
```

- [ ] **Step 13.5: Commit**

```bash
git add deploy/ai.opencode.remote-control.telegram.plist
git commit -m "deploy: add launchd plist with KeepAlive supervision"
```

---

## Task 14: MVP Acceptance Walk-Through

This is **manual**. No code; checklist execution.

- [ ] **Step 14.1: Open Telegram chat with your bot. Send `/start`**

Expected: handshake with health check showing `✅ healthy`.

- [ ] **Step 14.2: Confirm TUI is running on `:4096` (visible on Mac)**

- [ ] **Step 14.3: Send a chat message: "What's 2 + 2?"**

Expected:
- Within 5 seconds: TUI shows the message as if typed locally.
- Telegram shows `💭 thinking...` that updates progressively.
- Final reply appears (status message deleted, full text below).

- [ ] **Step 14.4: Send a long-output prompt: "Print the first 200 lines of Pride and Prejudice."**

Expected: reply split into multiple Telegram messages (each ≤ 4000 chars).

- [ ] **Step 14.5: Kill the TUI. Send another message.**

Expected: Telegram replies `❌ TUI not running. Please start opencode TUI on your Mac.`

- [ ] **Step 14.6: Restart TUI. Trigger a tool that needs approval**

Send a message like: "Create a file `/tmp/test_approval.txt` with content hello".

Expected:
- Telegram receives a 🔐 Approval Required card with three buttons.
- Click **✅ Allow Once** → card edits to "✅ Allowed (once)" + title; opencode proceeds; file is created.

- [ ] **Step 14.7: Trigger another approval; this time click in TUI instead of Telegram**

Expected: Telegram card updates to "(from TUI)" automatically.

- [ ] **Step 14.8: `/sessions` → list shows your active session(s)**

- [ ] **Step 14.9: Mid-response, send `/abort`**

Send a long-running prompt, then quickly `/abort`.

Expected: opencode stops; Telegram replies "🛑 Aborted <id>".

- [ ] **Step 14.10: KeepAlive verification — kill the bot PID**

```bash
launchctl list | grep ai.opencode.remote-control.telegram
# note the PID
kill -9 <PID>
sleep 6
launchctl list | grep ai.opencode.remote-control.telegram
# expect a NEW PID
```

- [ ] **Step 14.11: Network blip simulation — disable Wi-Fi for 30 seconds**

Disable Wi-Fi for 30s; re-enable. Send a message.

Expected: bot recovers, your message processes normally.

- [ ] **Step 14.12: Unauthorized user test**

From a different Telegram account (or temporarily change `ALLOWED_USER_ID`), send any message.

Expected: bot replies `Unauthorized` and ignores otherwise.

- [ ] **Step 14.13: 24-hour soak**

Leave it running. Check next day:

```bash
launchctl list | grep ai.opencode.remote-control.telegram
# exit code column should show 0 (not non-zero); PID should be stable
tail -100 /tmp/opencode-remote-control-telegram.err
# expected: empty or only benign SSE reconnect warnings
```

---

## Self-Review

Run this checklist against the spec:

**Spec coverage:**
- §2 architecture → Tasks 0, 11 (entry wires single-process sidecar) ✅
- §3 file layout → Tasks 0-11 create each file exactly as specified ✅
- §4.1 chat flow → Task 8 ✅
- §4.2 tui-bridge.submit → Task 6 ✅
- §4.3 event-stream → Task 5 ✅
- §4.4 approval (bi-directional) → Task 9 ✅
- §4.5 throttled edit + chunking → Task 7 ✅
- §4.6 commands → Task 10 ✅
- §5.1 failure matrix → Tasks 8 (TUI errors), 11 (health retry, polling retry), 5 (SSE reconnect) ✅
- §5.3 SIGINT/SIGTERM → Task 11 ✅
- §6.2 unit tests (~30) → Tasks 1-7 each add tests (markdown 7 + config 4 + client 4 + event-stream 7 + tui-bridge 5 + reply 8 ≈ 35) ✅
- §6.3 acceptance checklist → Task 14 manual walkthrough ✅
- §7 deployment → Task 13 ✅

**Placeholder scan:** None — every step has explicit code or commands.

**Type consistency:**
- `tuiBridge.submit(text, opts) → Promise<string>` — same signature across Task 6 (def) and Task 8 (consumer) ✅
- `eventStream.session(id, signal)` — defined Task 5, used Task 8 ✅
- `eventStream.onAny(handler) → () => void` — defined Task 5, used Task 9 ✅
- `createReplyStream(ctx, msgId, opts) → ReplyStream` — defined Task 7, used Task 8 ✅
- `lastSessionId` state owned by `bot/index.ts`, accessed via `getLastSessionId`/`setLastSessionId` injection (Tasks 10, 11) ✅
- `EventStream.extractSessionID` covers all 3 payload shapes from spec §4.3 (Task 5 implementation matches) ✅

No gaps found.
