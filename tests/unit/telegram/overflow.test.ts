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
    deleteMessage: vi.fn(async () => {}),
  }
}

describe('TelegramSessionRenderer overflow', () => {
  it('paginates a long final answer into multiple Telegram messages', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const longMd = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}: ${'x'.repeat(200)}`).join('\n\n')
    await r.onCard({ kind: 'assistant', sessionId: 'ses', blocks: [{ type: 'text', text: longMd }], meta: { cost: 0.04 } })
    // finalize sends new messages (not edits) for each piece
    // thinking + at least 2 finalize pieces
    expect(bot.sent.length).toBeGreaterThanOrEqual(3)
    const last = bot.sent.at(-1)!
    expect(last.text).toMatch(/\$0\.040/)
  })
})
