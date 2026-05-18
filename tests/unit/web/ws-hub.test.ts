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

  it('replies pong to ping', async () => {
    const hub = createWsHub({ cardBus: createCardBus(), client: fakeClient(), state: fakeState() })
    const ws = fakeWs()
    await hub.attach(ws as any, { email: 'u@x' } as any)
    hub.handleClientMessage(ws as any, { type: 'ping' })
    expect(ws.sent.at(-1)).toEqual({ type: 'pong' })
  })
})
