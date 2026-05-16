import { describe, it, expect, vi } from 'vitest'
import { createRelay } from '../../src/core/relay'
import { createCardBus } from '../../src/core/card-bus'
import type { StructuredCard } from '../../src/core/structured-card'

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
    setActiveAbort: vi.fn((id: string, ac: AbortController | undefined) => {
      if (ac === undefined) aborts.delete(id)
      else aborts.set(id, ac)
    }),
    getSessionCost: () => undefined,
    setSessionCost: vi.fn(),
    flush: async () => {},
  } as any
}

describe('createRelay', () => {
  it('publishes thinking + user + assistant sequence', async () => {
    const cardBus = createCardBus()
    const cards: StructuredCard[] = []
    cardBus.subscribeAll((c) => cards.push(c))

    const relay = createRelay({
      cardBus,
      client: fakeClient(),
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })

    expect(cards.some(c => c.kind === 'thinking')).toBe(true)
    expect(cards.some(c => c.kind === 'user' && (c as any).text === 'hi')).toBe(true)
    expect(cards.some(c => c.kind === 'assistant')).toBe(true)
  })

  it('publishes streaming card with merged tools', async () => {
    const cardBus = createCardBus()
    const cards: StructuredCard[] = []
    cardBus.subscribeAll((c) => cards.push(c))

    const relay = createRelay({
      cardBus,
      client: fakeClient(),
      eventStream: fakeEventStream([
        { type: 'message.part.updated', properties: { messageID: 'm1', part: { type: 'tool', tool: 'bash', state: { input: { command: 'ls' } } } } },
        { type: 'session.idle', properties: {} },
      ]),
      state: fakeState(),
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'x', messageId: 'msg' })

    const streaming = cards.filter(c => c.kind === 'streaming')
    expect(streaming.length).toBeGreaterThan(0)
    expect((streaming[streaming.length - 1] as any).tools[0].tool).toBe('bash')
  })

  it('publishes error card on session.error', async () => {
    const cardBus = createCardBus()
    const cards: StructuredCard[] = []
    cardBus.subscribeAll((c) => cards.push(c))

    const relay = createRelay({
      cardBus,
      client: fakeClient(),
      eventStream: fakeEventStream([
        { type: 'session.error', properties: { error: { message: 'boom' } } },
      ]),
      state: fakeState(),
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'x', messageId: 'msg' })

    expect(cards.some(c => c.kind === 'error' && (c as any).message === 'boom')).toBe(true)
  })

  it('mirrors prompt to TUI when tuiVisible=true', async () => {
    const client = fakeClient()
    const relay = createRelay({
      cardBus: createCardBus(),
      client,
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
      chatTimeoutMs: 5000,
      tuiVisible: true,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.tui.appendPrompt).toHaveBeenCalledWith({ body: { text: 'hi' } })
  })

  it('does NOT call TUI when tuiVisible=false', async () => {
    const client = fakeClient()
    const relay = createRelay({
      cardBus: createCardBus(),
      client,
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.tui.appendPrompt).not.toHaveBeenCalled()
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
      cardBus: createCardBus(),
      client,
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state: fakeState(),
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
    const cardBus = createCardBus()
    const cards: StructuredCard[] = []
    cardBus.subscribeAll((c) => cards.push(c))

    const relay = createRelay({
      cardBus,
      client,
      eventStream: fakeEventStream([]),
      state: fakeState(),
      chatTimeoutMs: 120000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.session.promptAsync).toHaveBeenCalledTimes(5)
    const errorCard = cards.find(c => c.kind === 'error')
    expect(errorCard).toBeDefined()
    expect((errorCard as any).message).toMatch(/fetch failed/)
  }, 60000)

  it('does NOT retry on non-network errors', async () => {
    const client = fakeClient()
    client.session.promptAsync = vi.fn().mockRejectedValue(new Error('no session found'))
    const cardBus = createCardBus()
    const cards: StructuredCard[] = []
    cardBus.subscribeAll((c) => cards.push(c))

    const relay = createRelay({
      cardBus,
      client,
      eventStream: fakeEventStream([]),
      state: fakeState(),
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.session.promptAsync).toHaveBeenCalledTimes(1)
    const errorCard = cards.find(c => c.kind === 'error')
    expect(errorCard).toBeDefined()
    expect((errorCard as any).message).toMatch(/no session found/)
  })

  it('stops retrying when aborted', async () => {
    const client = fakeClient()
    const state = fakeState()
    client.session.promptAsync = vi.fn().mockImplementation(async (opts: any) => {
      if (opts.signal?.aborted) throw new Error('aborted')
      throw new Error('fetch failed')
    })
    const relay = createRelay({
      cardBus: createCardBus(),
      client,
      eventStream: fakeEventStream([]),
      state,
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    setTimeout(() => {
      const ac = state.getActiveAbort('ses_test')
      ac?.abort()
    }, 10)
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.session.promptAsync).toHaveBeenCalledTimes(1)
  })

  it('registers abort controller in state during run', async () => {
    const state = fakeState()
    const relay = createRelay({
      cardBus: createCardBus(),
      client: fakeClient(),
      eventStream: fakeEventStream([{ type: 'session.idle', properties: {} }]),
      state,
      chatTimeoutMs: 5000,
      tuiVisible: false,
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(state.setActiveAbort).toHaveBeenCalledTimes(2)
    expect(state.setActiveAbort).toHaveBeenNthCalledWith(1, 'ses_test', expect.any(AbortController))
    expect(state.setActiveAbort).toHaveBeenNthCalledWith(2, 'ses_test', undefined)
  })
})
