import { describe, it, expect, vi } from 'vitest'
import { createChatHandler } from '../../src/bot/handlers/chat'

function fakeEventStream() {
  const listeners = new Set<(e: unknown) => void>()
  return {
    session: vi.fn(),
    onAny: vi.fn((h: (e: unknown) => void) => {
      listeners.add(h)
      return () => listeners.delete(h)
    }),
    setStatusChecker: vi.fn(),
  } as any
}

function fakeTuiBridge() {
  return {
    submit: vi.fn().mockResolvedValue('ses_test'),
    getStatus: vi.fn().mockResolvedValue({}),
    pickSession: vi.fn().mockResolvedValue('ses_test'),
  } as any
}

function fakeClient() {
  return {
    session: {
      message: vi.fn().mockResolvedValue({ data: { parts: [] } }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  } as any
}

function makeCtx() {
  const editMessageText = vi.fn().mockResolvedValue(true)
  const deleteMessage = vi.fn().mockResolvedValue(true)
  const reply = vi.fn().mockResolvedValue({ message_id: 42 })
  return {
    reply,
    deleteMessage,
    telegram: { editMessageText },
    chat: { id: 100 },
    sendChatAction: vi.fn().mockResolvedValue(true),
  } as any
}

describe('createChatHandler', () => {
  it('can be created without error', () => {
    const handler = createChatHandler({
      tuiBridge: fakeTuiBridge(),
      eventStream: fakeEventStream(),
      client: fakeClient(),
      editThrottleMs: 1000,
      chatTimeoutMs: 5000,
      streamOutput: true,
      getLastSessionId: () => undefined,
      setLastSessionId: () => {},
    })
    expect(handler).toBeInstanceOf(Function)
  })
})
