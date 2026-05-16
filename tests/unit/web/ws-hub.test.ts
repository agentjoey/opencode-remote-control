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
    expect(ws.sent.at(-1)).toEqual({ type: 'pong' })
  })
})
