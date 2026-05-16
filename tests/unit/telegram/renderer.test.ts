import { describe, it, expect, vi } from 'vitest'
import { TelegramSessionRenderer } from '../../../src/transport/telegram/renderer'
import type { StructuredCard } from '../../../src/core/structured-card'

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
  }
}

describe('TelegramSessionRenderer', () => {
  it('sends thinking card with Stop button on kind=thinking', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    expect(bot.sent).toHaveLength(1)
    expect(bot.sent[0].text).toMatch(/Working/i)
    expect(bot.sent[0].options.reply_markup.inline_keyboard[0][0].text).toBe('⏹ Stop')
  })

  it('ignores kind=user (Telegram already shows the user message)', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'user', sessionId: 'ses', text: 'hi', ts: 0 })
    expect(bot.sent).toHaveLength(0)
  })

  it('finalizes streaming with assistant footer (single chunk)', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    await r.onCard({ kind: 'streaming', sessionId: 'ses', markdownSrc: 'partial', tools: [] })
    await r.onCard({ kind: 'assistant', sessionId: 'ses', markdownSrc: 'final', tools: [], meta: { cost: 0.04, agent: 'build', model: 'k2p6' } })
    const last = bot.edits.at(-1)!
    expect(last.text).toMatch(/final/)
    expect(last.text).toMatch(/\$0\.040/)
    expect(last.text).toMatch(/build/)
  })

  it('throttles consecutive streaming edits', async () => {
    vi.useFakeTimers()
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    // 6 rapid deltas — first immediate, next 5 throttled
    for (let i = 0; i < 6; i++) {
      await r.onCard({ kind: 'streaming', sessionId: 'ses', markdownSrc: 'x'.repeat(i + 1), tools: [] })
    }
    expect(bot.edits.length).toBeLessThanOrEqual(2)  // first edit + maybe one throttled
    vi.advanceTimersByTime(2000)
    vi.useRealTimers()
  })

  it('collapses tools list: first 2 + last 5 with … N more when count is 8-15', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const tools = Array.from({ length: 12 }, (_, i) => ({
      tool: 'bash', args: `cmd${i}`, status: 'done' as const,
    }))
    await r.onCard({ kind: 'assistant', sessionId: 'ses', markdownSrc: 'done', tools, meta: {} })
    const last = bot.edits.at(-1)!
    expect(last.text).toMatch(/cmd0/)
    expect(last.text).toMatch(/cmd1/)
    expect(last.text).toMatch(/cmd7/)        // last 5 → cmd7..cmd11
    expect(last.text).toMatch(/cmd11/)
    expect(last.text).toMatch(/… 5 more tool calls/)
    expect(last.text).not.toMatch(/cmd5/)    // collapsed
  })

  it('collapses tools list: first 1 + last 4 when count > 15', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const tools = Array.from({ length: 20 }, (_, i) => ({
      tool: 'bash', args: `cmd${i}`, status: 'done' as const,
    }))
    await r.onCard({ kind: 'assistant', sessionId: 'ses', markdownSrc: 'done', tools, meta: {} })
    const last = bot.edits.at(-1)!
    expect(last.text).toMatch(/cmd0/)
    expect(last.text).toMatch(/cmd16/)
    expect(last.text).toMatch(/cmd19/)
    expect(last.text).toMatch(/… 15 more tool calls/)
  })
})
