import { describe, it, expect, vi } from 'vitest'
import { TelegramSessionRenderer } from '../../../src/transport/telegram/renderer'

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

describe('TelegramSessionRenderer overflow', () => {
  it('paginates a long final answer into multiple Telegram messages', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const longMd = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}: ${'x'.repeat(200)}`).join('\n\n')
    await r.onCard({ kind: 'assistant', sessionId: 'ses', markdownSrc: longMd, tools: [], meta: { cost: 0.04 } })
    // expect at least 2 messages sent (the initial thinking + ≥1 continuation)
    expect(bot.sent.length).toBeGreaterThanOrEqual(2)
    // last message should contain the meta footer
    const last = bot.sent.at(-1)!
    expect(last.text).toMatch(/\$0\.040/)
  })

  it('streaming paginates at soft limit on natural boundary', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    // accumulate text past CHUNK_SOFT_LIMIT then end on \n\n
    let md = ''
    for (let i = 0; i < 4; i++) {
      md += 'Y'.repeat(1000) + '\n\n'
      await r.onCard({ kind: 'streaming', sessionId: 'ses', markdownSrc: md, tools: [] })
    }
    expect(bot.sent.length).toBeGreaterThanOrEqual(2)
  })
})
