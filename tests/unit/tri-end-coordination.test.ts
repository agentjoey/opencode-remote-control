import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCardBus } from '../../src/core/card-bus.js'
import { createRelay } from '../../src/core/relay.js'
import { TelegramSessionRenderer } from '../../src/transport/telegram/renderer.js'
import type { CardBus } from '../../src/core/card-bus.js'
import type { StructuredCard } from '../../src/core/structured-card.js'

/**
 * Tri-end coordination tests: TUI ↔ Bot (Telegram) ↔ Web
 *
 * These tests verify that cards published by any transport reach all
 * subscribers via CardBus, and that the approval flow works end-to-end.
 */

function fakeBot() {
  return {
    sent: [] as Array<{ chatId: string; text: string; options: any }>,
    edits: [] as Array<{ chatId: string; messageId: string; text: string; options: any }>,
    sendMessage: vi.fn(async function (this: any, chatId: string, text: string, options: any) {
      this.sent.push({ chatId, text, options })
      return { message_id: this.sent.length }
    }),
    editMessageText: vi.fn(async function (this: any, chatId: string, messageId: number, _: any, text: string, options: any) {
      this.edits.push({ chatId, messageId: String(messageId), text, options })
    }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Tri-End Coordination (CardBus)', () => {
  let cardBus: CardBus

  beforeEach(() => {
    cardBus = createCardBus(100)
  })

  // ── Bot → Web visibility ──

  it('telegram-published assistant card is visible to Web subscriber', () => {
    const webCards: StructuredCard[] = []
    cardBus.subscribeAll((c) => webCards.push(c))

    cardBus.publish({
      kind: 'assistant',
      sessionId: 'ses_01',
      blocks: [{ type: 'text', text: 'Hello from bot' }],
      meta: { agent: 'build', model: 'claude-sonnet' },
    })

    expect(webCards).toHaveLength(1)
    expect(webCards[0]).toMatchObject({
      kind: 'assistant',
      sessionId: 'ses_01',
    })
  })

  // ── Web → Bot visibility ──

  it('web-published user card is visible to Telegram subscriber', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses_web', bot: bot as any })

    cardBus.subscribeAll((c) => r.onCard(c).catch(() => {}))

    cardBus.publish({
      kind: 'user',
      sessionId: 'ses_web',
      text: 'Sent from Web UI',
      ts: Date.now(),
    })

    // Allow async onCard to resolve
    await vi.waitFor(() => expect(bot.sent.length).toBeGreaterThan(0), { timeout: 1000 })
    expect(bot.sent[0].text).toContain('Sent from Web UI')
  })

  // ── Approval flow → CardBus → Web ──

  it('approval card published to CardBus is visible to Web subscriber', () => {
    const webCards: StructuredCard[] = []
    cardBus.subscribeAll((c) => webCards.push(c))

    cardBus.publish({
      kind: 'approval',
      sessionId: 'ses_appr',
      title: 'Edit /src/foo.ts',
      args: { type: 'edit', filePath: '/src/foo.ts' },
      requestId: 'perm_001',
    })

    expect(webCards).toHaveLength(1)
    expect(webCards[0]).toMatchObject({
      kind: 'approval',
      sessionId: 'ses_appr',
      title: 'Edit /src/foo.ts',
      requestId: 'perm_001',
    })
  })

  // ── Thinking cards propagate ──

  it('thinking card published reaches all subscribers', () => {
    const allCards: StructuredCard[] = []
    cardBus.subscribeAll((c) => allCards.push(c))

    cardBus.publish({ kind: 'thinking', sessionId: 'ses_t', showStop: true })

    expect(allCards).toHaveLength(1)
    expect(allCards[0].kind).toBe('thinking')
  })

  // ── Error cards propagate ──

  it('error card published reaches all subscribers', () => {
    const allCards: StructuredCard[] = []
    cardBus.subscribeAll((c) => allCards.push(c))

    cardBus.publish({ kind: 'error', sessionId: 'ses_err', message: 'Something went wrong' })

    expect(allCards).toHaveLength(1)
    expect(allCards[0]).toMatchObject({
      kind: 'error',
      message: 'Something went wrong',
    })
  })

  // ── Status cards propagate ──

  it('status card published reaches all subscribers', () => {
    const allCards: StructuredCard[] = []
    cardBus.subscribeAll((c) => allCards.push(c))

    cardBus.publish({ kind: 'status', sessionId: 'ses_st', fields: { status: 'idle' } })

    expect(allCards).toHaveLength(1)
    expect(allCards[0]).toMatchObject({
      kind: 'status',
      fields: { status: 'idle' },
    })
  })

  // ── Info cards propagate ──

  it('info card published reaches all subscribers', () => {
    const allCards: StructuredCard[] = []
    cardBus.subscribeAll((c) => allCards.push(c))

    cardBus.publish({
      kind: 'info',
      sessionId: 'ses_info',
      title: 'Session finished',
      sections: [{ body: 'Done in 120s' }],
    })

    expect(allCards).toHaveLength(1)
    expect(allCards[0].kind).toBe('info')
  })

  // ── Per-session subscription ──

  it('per-session subscriber only receives cards for their session', () => {
    const sessionCards: StructuredCard[] = []
    cardBus.subscribe('ses_a', (c) => sessionCards.push(c))

    cardBus.publish({ kind: 'thinking', sessionId: 'ses_a', showStop: true })
    cardBus.publish({ kind: 'thinking', sessionId: 'ses_b', showStop: false })
    cardBus.publish({ kind: 'assistant', sessionId: 'ses_a', blocks: [{ type: 'text', text: 'ok' }], meta: {} })

    expect(sessionCards).toHaveLength(2)
    expect(sessionCards[0].sessionId).toBe('ses_a')
    expect(sessionCards[1].sessionId).toBe('ses_a')
  })

  // ── Unsubscribe ──

  it('unsubscribe stops receiving cards', () => {
    const cards: StructuredCard[] = []
    const unsub = cardBus.subscribeAll((c) => cards.push(c))

    cardBus.publish({ kind: 'thinking', sessionId: 'ses', showStop: true })
    expect(cards).toHaveLength(1)

    unsub()
    cardBus.publish({ kind: 'thinking', sessionId: 'ses', showStop: false })
    expect(cards).toHaveLength(1) // no new card
  })

  // ── Recent / history buffer ──

  it('recent returns buffered cards for replay', () => {
    cardBus.publish({ kind: 'user', sessionId: 'ses_hist', text: 'Hello', ts: 1 })
    cardBus.publish({ kind: 'thinking', sessionId: 'ses_hist', showStop: true })
    cardBus.publish({
      kind: 'assistant',
      sessionId: 'ses_hist',
      blocks: [{ type: 'text', text: 'Hi!' }],
      meta: {},
    })

    const history = cardBus.recent('ses_hist')
    expect(history).toHaveLength(3)
    expect(history[0].kind).toBe('user')
    expect(history[2].kind).toBe('assistant')
  })
})

describe('Plugin-mode Relay (no eventStream)', () => {
  it('publishes thinking + user cards via CardBus when handling incoming message', async () => {
    const bus = createCardBus()
    const allCards: StructuredCard[] = []
    bus.subscribeAll((c) => allCards.push(c))

    const relay = createRelay({
      cardBus: bus,
      client: {
        session: {
          promptAsync: vi.fn().mockResolvedValue({ data: {} }),
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'ses_default', time: { created: Date.now(), updated: Date.now() } }],
          }),
        },
        tui: { appendPrompt: vi.fn(), submitPrompt: vi.fn() },
      } as any,
      state: {
        getPinnedSessionId: () => undefined,
        getLastSessionId: () => undefined,
        getNextAgent: () => undefined,
        getNextModel: () => undefined,
        setLastSessionId: vi.fn(),
        setActiveAbort: vi.fn(),
      } as any,
      chatTimeoutMs: 30000,
      tuiVisible: false,
    })

    await relay({ userId: 'u1', chatId: 'c1', text: 'ping', messageId: 'm1' })

    // In plugin mode (no eventStream), thinking + user cards should be published
    const thinkingCard = allCards.find((c) => c.kind === 'thinking')
    const userCard = allCards.find((c) => c.kind === 'user')
    expect(thinkingCard).toBeDefined()
    expect(userCard).toBeDefined()
    expect(userCard).toMatchObject({ text: 'ping' })
  })
})
