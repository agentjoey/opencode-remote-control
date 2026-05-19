import { describe, it, expect, vi } from 'vitest'
import { TelegramSessionRenderer } from '../../src/transport/telegram/renderer'

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

describe('Telegram overflow integration', () => {
  it('15000-char final answer produces >=3 messages with footer on last', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const longMd = Array.from({ length: 80 }, (_, i) => `Section ${i}:\n${'x'.repeat(200)}`).join('\n\n')
    expect(longMd.length).toBeGreaterThan(15000)
    await r.onCard({ kind: 'assistant', sessionId: 'ses', blocks: [{ type: 'text', text: longMd }], meta: { cost: 0.1 } })
    expect(bot.sent.length).toBeGreaterThanOrEqual(3)
    const last = bot.sent.at(-1)!
    expect(last.text).toMatch(/\$0\.100/)
  })
})
