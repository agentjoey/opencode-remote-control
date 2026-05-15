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

  it('drains queued events before exiting on abort (race condition fix)', async () => {
    const es = new EventStream()
    es.start(fakeClient([
      { type: 'session.idle', properties: { sessionID: 'ses_drain' } },
      { type: 'session.idle', properties: { sessionID: 'ses_drain' } },
    ]))

    const ac = new AbortController()
    const collected: unknown[] = []

    setTimeout(() => ac.abort(), 10)

    for await (const ev of es.session('ses_drain', ac.signal)) {
      collected.push(ev)
    }

    expect(collected.length).toBe(2)
    es.stop()
  })
})
