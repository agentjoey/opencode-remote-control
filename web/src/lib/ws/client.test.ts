import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWsClient } from './client'
import { connection } from '../stores/connection'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  url: string
  readyState = 0
  onopen?: () => void
  onmessage?: (ev: MessageEvent) => void
  onclose?: () => void
  onerror?: () => void
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
    setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0)
  }

  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3; this.onclose?.() }
}

describe('createWsClient', () => {
  beforeEach(() => { FakeWebSocket.instances = []; vi.stubGlobal('WebSocket', FakeWebSocket) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('connects and emits messages to handlers', async () => {
    const onMessage = vi.fn()
    createWsClient({ url: 'ws://test', onMessage })
    await new Promise((r) => setTimeout(r, 10))
    const ws = FakeWebSocket.instances[0]
    ws.onmessage?.({ data: JSON.stringify({ type: 'card', card: { kind: 'thinking' } }) } as any)
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'card' }))
  })

  it('sends subscribe over WS', async () => {
    const client = createWsClient({ url: 'ws://test' })
    await new Promise((r) => setTimeout(r, 10))
    const ws = FakeWebSocket.instances[0]
    ws.readyState = 1
    client.send({ type: 'subscribe', sessionId: 'ses_1' })
    expect(ws.sent[0]).toBe(JSON.stringify({ type: 'subscribe', sessionId: 'ses_1' }))
    client.close()
  })
})
