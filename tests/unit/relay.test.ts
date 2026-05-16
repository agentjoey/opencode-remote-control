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
      promptAsync: vi.fn().mockResolvedValue({ data: {} }),
      list: vi.fn().mockResolvedValue({ data: [{ id: 'ses_test', time: { created: 1 } }] }),
      get: vi.fn().mockResolvedValue({ data: { cost: 0.04, tokens: { input: 5100, output: 1200 }, agent: { name: 'build' }, model: 'k2p6' } }),
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
      if (ac === undefined) aborts.delete(id)
      else aborts.set(id, ac)
    },
    getSessionCost: () => undefined,
    setSessionCost: vi.fn(),
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
    expect(transport.sent[0].lines[0]).toMatch(/Working/i)
  })

  it('calls session.promptAsync with the session id', async () => {
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
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'ses_test' },
        body: expect.objectContaining({ parts: [{ type: 'text', text: 'hi' }] }),
      }),
    )
  })

  it('passes nextAgent and nextModel from state to session.promptAsync', async () => {
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
    expect(client.session.promptAsync).toHaveBeenCalledWith(
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

  it('retries submitPrompt on network error then succeeds', async () => {
    const client = fakeClient()
    let calls = 0
    client.session.promptAsync = vi.fn().mockImplementation(async () => {
      calls++
      if (calls <= 2) throw new Error('fetch failed')
      return { data: {} }
    })
    const relay = createRelay({
      transport: fakeTransport(),
      client,
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
      editThrottleMs: 1000,
      chatTimeoutMs: 120000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(calls).toBe(3)
    expect(client.session.promptAsync).toHaveBeenCalledTimes(3)
  })

  it('gives up after max retries on network error', async () => {
    const client = fakeClient()
    client.session.promptAsync = vi.fn().mockRejectedValue(new Error('fetch failed'))
    const transport = fakeTransport()
    const relay = createRelay({
      transport,
      client,
      eventStream: fakeEventStream([]),
      state: fakeState(),
      editThrottleMs: 1000,
      chatTimeoutMs: 120000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.session.promptAsync).toHaveBeenCalledTimes(5)
    // Should show error card
    const lastEdit = transport.edits[transport.edits.length - 1]
    expect(lastEdit.lines[0]).toMatch(/Error/)
    expect(lastEdit.lines[0]).toMatch(/fetch failed/)
  }, 60000)

  it('does NOT retry on non-network errors', async () => {
    const client = fakeClient()
    client.session.promptAsync = vi.fn().mockRejectedValue(new Error('no session found'))
    const transport = fakeTransport()
    const relay = createRelay({
      transport,
      client,
      eventStream: fakeEventStream([]),
      state: fakeState(),
      editThrottleMs: 1000,
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.session.promptAsync).toHaveBeenCalledTimes(1)
    const lastEdit = transport.edits[transport.edits.length - 1]
    expect(lastEdit.lines[0]).toMatch(/Error/)
    expect(lastEdit.lines[0]).toMatch(/no session found/)
  })

  it('stops retrying when aborted', async () => {
    const client = fakeClient()
    const state = fakeState()
    client.session.promptAsync = vi.fn().mockImplementation(async (opts: any) => {
      if (opts.signal?.aborted) throw new Error('aborted')
      throw new Error('fetch failed')
    })
    const transport = fakeTransport()
    const relay = createRelay({
      transport,
      client,
      eventStream: fakeEventStream([]),
      state,
      editThrottleMs: 1000,
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    // Abort after a tick
    setTimeout(() => {
      const ac = state.getActiveAbort('ses_test')
      ac?.abort()
    }, 10)
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    // Abort fires during first retry wait → 1 call (abort interrupts the delay)
    expect(client.session.promptAsync).toHaveBeenCalledTimes(1)
  })
})
