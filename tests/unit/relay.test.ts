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
    const transport = fakeTransport()
    const client = fakeClient()
    const relay = createRelay({
      transport,
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

  it('emits ▸ tool · args line on tool part', async () => {
    const transport = fakeTransport()
    const relay = createRelay({
      transport,
      client: fakeClient(),
      eventStream: fakeEventStream([
        { type: 'message.part.updated', properties: { messageID: 'm1', part: { type: 'tool', tool: 'bash', state: { input: { command: 'ls' } } } } },
        { type: 'session.idle', properties: {} },
      ]),
      state: fakeState(),
      editThrottleMs: 0,
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'x', messageId: 'msg' })
    const last = transport.edits[transport.edits.length - 1]
    expect(last.lines.join('\n')).toMatch(/▸ bash · ls/)
  })
})
