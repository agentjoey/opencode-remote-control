import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRelay } from '../../src/core/relay'
import { createCardBus } from '../../src/core/card-bus'
import type { StructuredCard } from '../../src/core/structured-card'

// selectTuiSession uses raw fetch (SDK v1 lacks tui.selectSession).
// Stub global fetch so tests don't hit real localhost:4096 — that would
// navigate the developer's actual TUI.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function fakeClient() {
  return {
    session: {
      promptAsync: vi.fn().mockResolvedValue({ data: {} }),
      list: vi.fn().mockResolvedValue({ data: [{ id: 'ses_test', time: { created: 1 } }] }),
      get: vi.fn().mockResolvedValue({ data: { cost: 0.04, tokens: { input: 5100, output: 1200 }, agent: { name: 'build' }, model: 'k2p6' } }),
      message: vi.fn().mockResolvedValue({ data: { parts: [] } }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
    },
    tui: { appendPrompt: vi.fn(), submitPrompt: vi.fn() },
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
    getPinnedSessionId: () => undefined,
    setPinnedSessionId: vi.fn(),
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
  it('publishes thinking + user cards after submit, no assistant card until idle', async () => {
    const cardBus = createCardBus()
    const cards: StructuredCard[] = []
    cardBus.subscribeAll((c) => cards.push(c))

    const relay = createRelay({
      cardBus,
      client: fakeClient(),
      state: fakeState(),
      chatTimeoutMs: 5000,
      tuiVisible: false,
      baseUrl: 'http://localhost:4096',
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })

    expect(cards.some(c => c.kind === 'thinking')).toBe(true)
    expect(cards.some(c => c.kind === 'user' && (c as any).text === 'hi')).toBe(true)
    // assistant is published asynchronously via handleEvent on session.idle
    expect(cards.some(c => c.kind === 'assistant')).toBe(false)
  })

  it('routes to msg.sessionId (web-selected) over the global pinned session', async () => {
    const client = fakeClient()
    const state = fakeState()
    state.getPinnedSessionId = () => 'ses_pinned' // global pin points elsewhere
    const relay = createRelay({
      cardBus: createCardBus(),
      client,
      state,
      chatTimeoutMs: 5000,
      tuiVisible: false,
      baseUrl: 'http://localhost:4096',
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'm', sessionId: 'ses_web_selected' })
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'ses_web_selected' } }),
    )
  })

  it('navigates the TUI via /tui/select-session when tuiVisible', async () => {
    const client = fakeClient()
    const state = fakeState()
    state.getPinnedSessionId = () => 'ses_pinned'
    const relay = createRelay({
      cardBus: createCardBus(),
      client,
      state,
      chatTimeoutMs: 5000,
      tuiVisible: true,
      baseUrl: 'http://localhost:4096',
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.session.promptAsync).toHaveBeenCalled()
    expect((globalThis.fetch as any)).toHaveBeenCalledWith(
      'http://localhost:4096/tui/select-session',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('retries submitPrompt on network error then succeeds', async () => {
    const client = fakeClient()
    let calls = 0
    client.session.promptAsync = vi.fn().mockImplementation(async () => {
      calls++
      if (calls <= 2) throw new Error('fetch failed')
      return { data: {} }
    })
    const state = fakeState()
    state.getPinnedSessionId = () => 'ses_test'
    const relay = createRelay({
      cardBus: createCardBus(),
      client,
      state,
      chatTimeoutMs: 120000,
      tuiVisible: false,
      baseUrl: 'http://localhost:4096',
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

    const state = fakeState()
    state.getPinnedSessionId = () => 'ses_test'
    const relay = createRelay({
      cardBus,
      client,
      state,
      chatTimeoutMs: 120000,
      tuiVisible: false,
      baseUrl: 'http://localhost:4096',
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

    const state = fakeState()
    state.getPinnedSessionId = () => 'ses_test'
    const relay = createRelay({
      cardBus,
      client,
      state,
      chatTimeoutMs: 5000,
      tuiVisible: false,
      baseUrl: 'http://localhost:4096',
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
    state.getPinnedSessionId = () => 'ses_test'
    client.session.promptAsync = vi.fn().mockImplementation(async (opts: any) => {
      if (opts.signal?.aborted) throw new Error('aborted')
      throw new Error('fetch failed')
    })
    const relay = createRelay({
      cardBus: createCardBus(),
      client,
      state,
      chatTimeoutMs: 5000,
      tuiVisible: false,
      baseUrl: 'http://localhost:4096',
    })
    setTimeout(() => {
      const ac = state.getActiveAbort('ses_test')
      ac?.abort()
    }, 10)
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    expect(client.session.promptAsync).toHaveBeenCalledTimes(1)
  })

  it('registers abort controller during run, clears it on idle', async () => {
    const state = fakeState()
    state.getPinnedSessionId = () => 'ses_test'
    const relay = createRelay({
      cardBus: createCardBus(),
      client: fakeClient(),
      state,
      chatTimeoutMs: 5000,
      tuiVisible: false,
      baseUrl: 'http://localhost:4096',
    })
    await relay({ userId: '1', chatId: '100', text: 'hi', messageId: 'msg1' })
    // registered with an AbortController while in flight
    expect(state.setActiveAbort).toHaveBeenCalledWith('ses_test', expect.any(AbortController))
    expect(state.getActiveAbort('ses_test')).toBeInstanceOf(AbortController)
    // session idle clears it
    await relay.handleEvent({ type: 'session.idle', properties: { sessionID: 'ses_test' } })
    expect(state.setActiveAbort).toHaveBeenCalledWith('ses_test', undefined)
    expect(state.getActiveAbort('ses_test')).toBeUndefined()
  })

  // ── Streaming + finalization via the plugin event hook ──

  describe('plugin event hook', () => {
    it('publishes thinking + user cards and returns without assistant card', async () => {
      const cardBus = createCardBus()
      const cards: StructuredCard[] = []
      cardBus.subscribeAll((c) => cards.push(c))

      const state = fakeState()
      state.getPinnedSessionId = () => 'ses_plugin'
      const relay = createRelay({
        cardBus,
        client: fakeClient(),
        state,
        chatTimeoutMs: 5000,
        tuiVisible: false,
        baseUrl: 'http://localhost:4096',
      })
      await relay({ userId: '1', chatId: '100', text: 'plugin test', messageId: 'p1' })

      expect(cards.some(c => c.kind === 'thinking')).toBe(true)
      expect(cards.some(c => c.kind === 'user' && (c as any).text === 'plugin test')).toBe(true)
      expect(cards.some(c => c.kind === 'assistant')).toBe(false)
      expect(cards.some(c => c.kind === 'error')).toBe(false)
    })

    it('publishes streaming card via handleEvent for message.part.updated', async () => {
      const cardBus = createCardBus()
      const cards: StructuredCard[] = []
      cardBus.subscribeAll((c) => cards.push(c))

      const state = fakeState()
      state.getPinnedSessionId = () => 'ses_plugin'
      const relay = createRelay({
        cardBus,
        client: fakeClient(),
        state,
        chatTimeoutMs: 5000,
        tuiVisible: false,
        baseUrl: 'http://localhost:4096',
      })
      await relay({ userId: '1', chatId: '100', text: 'test', messageId: 'p2' })

      await relay.handleEvent({
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_plugin',
          part: { id: 't1', type: 'text', text: 'hello world' },
        },
      })

      const streamingCards = cards.filter(c => c.kind === 'streaming')
      expect(streamingCards.length).toBeGreaterThan(0)
      const lastStream = streamingCards[streamingCards.length - 1] as any
      expect(lastStream.blocks.some((b: any) => b.type === 'text' && b.text === 'hello world')).toBe(true)
    })

    it('publishes assistant card when session.idle fires', async () => {
      const cardBus = createCardBus()
      const cards: StructuredCard[] = []
      cardBus.subscribeAll((c) => cards.push(c))

      const state = fakeState()
      state.getPinnedSessionId = () => 'ses_plugin'
      const relay = createRelay({
        cardBus,
        client: fakeClient(),
        state,
        chatTimeoutMs: 5000,
        tuiVisible: false,
        baseUrl: 'http://localhost:4096',
      })
      await relay({ userId: '1', chatId: '100', text: 'test', messageId: 'p3' })

      await relay.handleEvent({
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_plugin',
          part: { id: 't1', type: 'text', text: 'response text' },
        },
      })

      await relay.handleEvent({
        type: 'session.idle',
        properties: { sessionID: 'ses_plugin' },
      })

      // publishAssistantCard is deferred via setTimeout(0); wait for it
      await new Promise((r) => setTimeout(r, 10))

      const assistantCard = cards.find(c => c.kind === 'assistant') as any
      expect(assistantCard).toBeDefined()
      expect(assistantCard.blocks.some((b: any) => b.type === 'text' && b.text === 'response text')).toBe(true)
    })

    it('publishes error card when session.error fires', async () => {
      const cardBus = createCardBus()
      const cards: StructuredCard[] = []
      cardBus.subscribeAll((c) => cards.push(c))

      const state = fakeState()
      state.getPinnedSessionId = () => 'ses_plugin'
      const relay = createRelay({
        cardBus,
        client: fakeClient(),
        state,
        chatTimeoutMs: 5000,
        tuiVisible: false,
        baseUrl: 'http://localhost:4096',
      })
      await relay({ userId: '1', chatId: '100', text: 'test', messageId: 'p4' })

      cards.length = 0

      await relay.handleEvent({
        type: 'session.error',
        properties: { sessionID: 'ses_plugin', error: { message: 'something broke' } },
      })

      const errorCard = cards.find(c => c.kind === 'error') as any
      expect(errorCard).toBeDefined()
      expect(errorCard.message).toMatch(/something broke/)
    })

    it('handles message.part.delta accumulation', async () => {
      const cardBus = createCardBus()
      const cards: StructuredCard[] = []
      cardBus.subscribeAll((c) => cards.push(c))

      const state = fakeState()
      state.getPinnedSessionId = () => 'ses_plugin'
      const relay = createRelay({
        cardBus,
        client: fakeClient(),
        state,
        chatTimeoutMs: 5000,
        tuiVisible: false,
        baseUrl: 'http://localhost:4096',
      })
      await relay({ userId: '1', chatId: '100', text: 'test', messageId: 'p5' })

      await relay.handleEvent({
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_plugin',
          part: { id: 'd1', type: 'text', text: 'Hello' },
        },
      })
      await relay.handleEvent({
        type: 'message.part.delta',
        properties: { partID: 'd1', field: 'text', delta: ' world', sessionID: 'ses_plugin' },
      })
      await relay.handleEvent({
        type: 'message.part.delta',
        properties: { partID: 'd1', field: 'text', delta: '!', sessionID: 'ses_plugin' },
      })
      await relay.handleEvent({
        type: 'session.idle',
        properties: { sessionID: 'ses_plugin' },
      })
      await new Promise((r) => setTimeout(r, 10))

      const assistantCard = cards.find(c => c.kind === 'assistant') as any
      expect(assistantCard).toBeDefined()
      expect(assistantCard.blocks.some((b: any) => b.type === 'text' && b.text === 'Hello world!')).toBe(true)
    })

    it('deduplicates tools by part.id on repeated tool updates', async () => {
      const cardBus = createCardBus()
      const cards: StructuredCard[] = []
      cardBus.subscribeAll((c) => cards.push(c))

      const state = fakeState()
      state.getPinnedSessionId = () => 'ses_plugin'
      const relay = createRelay({
        cardBus,
        client: fakeClient(),
        state,
        chatTimeoutMs: 5000,
        tuiVisible: false,
        baseUrl: 'http://localhost:4096',
      })
      await relay({ userId: '1', chatId: '100', text: 'x', messageId: 'p6' })

      await relay.handleEvent({
        type: 'message.part.updated',
        properties: { sessionID: 'ses_plugin', part: { type: 'tool', tool: 'bash', id: 't1', state: { input: { command: 'ls' }, status: 'running' } } },
      })
      await relay.handleEvent({
        type: 'message.part.updated',
        properties: { sessionID: 'ses_plugin', part: { type: 'tool', tool: 'bash', id: 't1', state: { input: { command: 'ls' }, status: 'done' } } },
      })
      await relay.handleEvent({
        type: 'session.idle',
        properties: { sessionID: 'ses_plugin' },
      })
      await new Promise((r) => setTimeout(r, 10))

      const final = cards.find(c => c.kind === 'assistant') as any
      const bashBlocks = final.blocks.filter((b: any) => b.type === 'tool' && b.tool === 'bash')
      expect(bashBlocks.length).toBe(1)
      expect(bashBlocks[0].status).toBe('done')
    })
  })
})
