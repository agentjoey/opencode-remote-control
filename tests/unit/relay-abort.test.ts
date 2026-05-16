import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRelay, type RelayDeps } from '../../src/core/relay.js'
import type { Transport } from '../../src/transport/interface.js'
import type { SessionState } from '../../src/core/state.js'

describe('inline stop button', () => {
  let state: SessionState
  let transport: Transport
  let relay: ReturnType<typeof createRelay>
  let sentCards: Array<{ chatId: string; card: any }>

  beforeEach(() => {
    sentCards = []
    state = {
      getLastSessionId: vi.fn().mockReturnValue('ses_123'),
      setLastSessionId: vi.fn(),
      getNextAgent: vi.fn().mockReturnValue(undefined),
      setNextAgent: vi.fn(),
      getNextModel: vi.fn().mockReturnValue(undefined),
      setNextModel: vi.fn(),
      getTuiSelectedSession: vi.fn().mockReturnValue(undefined),
      setTuiSelectedSession: vi.fn(),
      getCurrentAgent: vi.fn().mockReturnValue(undefined),
      setCurrentAgent: vi.fn(),
      getActiveAbort: vi.fn().mockReturnValue(undefined),
      setActiveAbort: vi.fn(),
      getSessionCost: vi.fn().mockReturnValue(undefined),
      setSessionCost: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionState

    transport = {
      name: 'mock',
      capabilities: { edit: true, maxMessageLength: 4096, buttons: true, richText: true, streaming: true },
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockImplementation((chatId, card) => {
        sentCards.push({ chatId, card })
        return Promise.resolve({ messageId: 'msg_1' })
      }),
      edit: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn(),
      onCommand: vi.fn(),
      onButtonClick: vi.fn(),
    }

    const client = {
      session: {
        list: vi.fn().mockResolvedValue({ data: [{ id: 'ses_123', time: { created: Date.now() } }] }),
        promptAsync: vi.fn().mockResolvedValue({ data: {} }),
      },
      tui: { appendPrompt: vi.fn().mockResolvedValue(undefined) },
    } as any

    const eventStream = {
      session: vi.fn().mockImplementation(async function* () {
        yield { type: 'session.idle', properties: {} }
      }),
    } as any

    const deps: RelayDeps = {
      transport,
      client,
      eventStream,
      state,
      editThrottleMs: 50,
      chatTimeoutMs: 30000,
      tuiVisible: false,
      toolCallsInline: true,
    }

    relay = createRelay(deps)
  })

  it('sends thinking card with stop button when transport supports buttons', async () => {
    await relay({ userId: 'u1', chatId: 'c1', text: 'hello', messageId: 'm1' })

    expect(sentCards).toHaveLength(1)
    const card = sentCards[0].card
    expect(card.lines).toEqual(['⏳  Working…'])
    expect(card.buttons).toBeDefined()
    expect(card.buttons[0][0].label).toBe('⏹ Stop')
    expect(card.buttons[0][0].data).toMatch(/^relay:abort:ses_123/)
  })

  it('does not include stop button when transport lacks button support', async () => {
    transport.capabilities.buttons = false
    await relay({ userId: 'u1', chatId: 'c1', text: 'hello', messageId: 'm1' })

    expect(sentCards).toHaveLength(1)
    const card = sentCards[0].card
    expect(card.lines).toEqual(['⏳  Working…'])
    expect(card.buttons).toBeUndefined()
  })

  it('registers and unregisters abort controller in state', async () => {
    await relay({ userId: 'u1', chatId: 'c1', text: 'hello', messageId: 'm1' })

    expect(state.setActiveAbort).toHaveBeenCalledTimes(2)
    expect(state.setActiveAbort).toHaveBeenNthCalledWith(1, 'ses_123', expect.any(AbortController))
    expect(state.setActiveAbort).toHaveBeenNthCalledWith(2, 'ses_123', undefined)
  })
})

describe('relay:abort callback', () => {
  it('aborts active generation when button clicked', () => {
    const ac = new AbortController()
    const state = {
      getActiveAbort: vi.fn().mockReturnValue(ac),
    } as unknown as SessionState

    // Simulate the callback logic from handlers.ts
    const sessionId = 'ses_123'
    const callbackAc = state.getActiveAbort(sessionId)
    expect(callbackAc).toBe(ac)
    callbackAc!.abort()
    expect(ac.signal.aborted).toBe(true)
  })

  it('gracefully handles missing abort controller', () => {
    const state = {
      getActiveAbort: vi.fn().mockReturnValue(undefined),
    } as unknown as SessionState

    const sessionId = 'ses_old'
    const callbackAc = state.getActiveAbort(sessionId)
    expect(callbackAc).toBeUndefined()
  })
})
