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

function fakeClient() {
  return {
    session: {
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  } as any
}

function fakeState() {
  return {
    getSessionCost: vi.fn().mockReturnValue(undefined),
  } as any
}

describe('WsHub', () => {
  it('broadcasts cards for subscribed sessionId', async () => {
    const bus = createCardBus()
    const hub = createWsHub({ cardBus: bus, client: fakeClient(), state: fakeState() })
    const ws = fakeWs()
    await hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'subscribe', sessionId: 'ses_1' })
    bus.publish({ kind: 'thinking', sessionId: 'ses_1', showStop: true })
    expect(ws.sent.some((m: any) => m.type === 'card')).toBe(true)
  })

  it('does not forward cards for other sessions', async () => {
    const bus = createCardBus()
    const hub = createWsHub({ cardBus: bus, client: fakeClient(), state: fakeState() })
    const ws = fakeWs()
    await hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'subscribe', sessionId: 'ses_1' })
    bus.publish({ kind: 'thinking', sessionId: 'ses_2', showStop: true })
    const cardMsgs = ws.sent.filter((m: any) => m.type === 'card')
    expect(cardMsgs.length).toBe(0)
  })

  it('does NOT broadcast proactive (push) cards to web — live', async () => {
    const bus = createCardBus()
    const hub = createWsHub({ cardBus: bus, client: fakeClient(), state: fakeState() })
    const ws = fakeWs()
    await hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'subscribe', sessionId: 'ses_1' })
    bus.publish({ kind: 'info', sessionId: 'ses_1', title: 'Test failure detected', sections: [], proactive: true })
    bus.publish({ kind: 'info', sessionId: 'ses_1', title: 'Normal info', sections: [] })
    const titles = ws.sent.filter((m: any) => m.type === 'card').map((m: any) => m.card.title)
    expect(titles).toEqual(['Normal info']) // proactive one filtered out
  })

  it('does NOT replay proactive (push) cards on subscribe', async () => {
    const bus = createCardBus()
    bus.publish({ kind: 'info', sessionId: 'ses_1', title: 'Session finished', sections: [], proactive: true }) // seq 1
    bus.publish({ kind: 'assistant', sessionId: 'ses_1', blocks: [], meta: {} })                                 // seq 2
    const hub = createWsHub({ cardBus: bus, client: fakeClient(), state: fakeState() })
    const ws = fakeWs()
    await hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'subscribe', sessionId: 'ses_1', sinceSeq: 0 })
    const kinds = ws.sent.filter((m: any) => m.type === 'card').map((m: any) => m.card.kind)
    expect(kinds).toEqual(['assistant']) // proactive info not replayed
  })

  it('replies pong to ping', async () => {
    const hub = createWsHub({ cardBus: createCardBus(), client: fakeClient(), state: fakeState() })
    const ws = fakeWs()
    await hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'ping' })
    expect(ws.sent.at(-1)).toEqual({ type: 'pong' })
  })

  it('replays buffered cards with seq > sinceSeq on subscribe, then replayEnd', async () => {
    const bus = createCardBus()
    bus.publish({ kind: 'user', sessionId: 'ses_1', text: 'a', ts: 0 })       // seq 1
    bus.publish({ kind: 'assistant', sessionId: 'ses_1', blocks: [], meta: {} }) // seq 2
    bus.publish({ kind: 'assistant', sessionId: 'ses_1', blocks: [], meta: {} }) // seq 3

    const hub = createWsHub({ cardBus: bus, client: fakeClient(), state: fakeState() })
    const ws = fakeWs()
    await hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'subscribe', sessionId: 'ses_1', sinceSeq: 1 })

    const replayed = ws.sent.filter((m: any) => m.type === 'card').map((m: any) => m.card.seq)
    expect(replayed).toEqual([2, 3]) // seq 1 already in the client's snapshot
    expect(ws.sent.at(-1)).toMatchObject({ type: 'replayEnd', sessionId: 'ses_1', lastSeq: 3 })
  })

  it('replays nothing when sinceSeq is current', async () => {
    const bus = createCardBus()
    bus.publish({ kind: 'user', sessionId: 'ses_1', text: 'a', ts: 0 }) // seq 1
    const hub = createWsHub({ cardBus: bus, client: fakeClient(), state: fakeState() })
    const ws = fakeWs()
    await hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'subscribe', sessionId: 'ses_1', sinceSeq: 1 })
    expect(ws.sent.filter((m: any) => m.type === 'card').length).toBe(0)
  })
})
