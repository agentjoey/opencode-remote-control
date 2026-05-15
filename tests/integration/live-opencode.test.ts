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
