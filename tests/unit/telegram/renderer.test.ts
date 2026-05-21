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
    deleteMessage: vi.fn(async () => {}),
  }
}

describe('TelegramSessionRenderer', () => {
  it('sends thinking card on kind=thinking', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    expect(bot.sent).toHaveLength(1)
    expect(bot.sent[0].text).toMatch(/Working/i)
  })

  it('streaming is a no-op', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    await r.onCard({ kind: 'streaming', sessionId: 'ses', blocks: [{ type: 'text', text: 'partial' }] })
    // streaming should not cause any sends or edits
    expect(bot.edits).toHaveLength(0)
    expect(bot.sent).toHaveLength(1) // only thinking
  })

  it('ignores kind=user', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'user', sessionId: 'ses', text: 'hi', ts: 0 })
    expect(bot.sent).toHaveLength(0)
  })

  it('finalize sends new message with assistant footer (single chunk)', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    await r.onCard({ kind: 'assistant', sessionId: 'ses', blocks: [{ type: 'text', text: 'final' }], meta: { cost: 0.04, agent: 'build', model: 'k2p6' } })
    // finalize sends new messages, not edits
    const assistantMsg = bot.sent.find((s: any) => s.text.includes('final'))
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg!.text).toMatch(/final/)
    expect(assistantMsg!.text).toMatch(/\$0\.040/)
    expect(assistantMsg!.text).toMatch(/build/)
  })

  it('collapses tools list: first 2 + last 5 with … N more when count is 8-15', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const tools = Array.from({ length: 12 }, (_, i) => ({
      tool: 'bash', args: `cmd${i}`, status: 'done' as const,
    }))
    await r.onCard({ kind: 'assistant', sessionId: 'ses', blocks: [{ type: 'text', text: 'done' }, ...tools.map(t => ({ type: 'tool' as const, tool: t.tool, args: t.args, status: t.status }))], meta: {} })
    const last = bot.sent.at(-1)!
    expect(last.text).toMatch(/cmd0/)
    expect(last.text).toMatch(/cmd1/)
    expect(last.text).toMatch(/cmd7/)
    expect(last.text).toMatch(/cmd11/)
    expect(last.text).toMatch(/… 5 more tool calls/)
    expect(last.text).not.toMatch(/cmd5/)
  })

  it('collapses tools list: first 1 + last 4 when count > 15', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const tools = Array.from({ length: 20 }, (_, i) => ({
      tool: 'bash', args: `cmd${i}`, status: 'done' as const,
    }))
    await r.onCard({ kind: 'assistant', sessionId: 'ses', blocks: [{ type: 'text', text: 'done' }, ...tools.map(t => ({ type: 'tool' as const, tool: t.tool, args: t.args, status: t.status }))], meta: {} })
    const last = bot.sent.at(-1)!
    expect(last.text).toMatch(/cmd0/)
    expect(last.text).toMatch(/cmd16/)
    expect(last.text).toMatch(/cmd19/)
    expect(last.text).toMatch(/… 15 more tool calls/)
  })

  it('pins running tools into tail (8-15 tools, 2 running)', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const tools: Array<{ tool: string; args: string; status: 'done' | 'running' }> = []
    for (let i = 0; i < 12; i++) {
      const status = (i === 2 || i === 4) ? 'running' : 'done'
      tools.push({ tool: 'bash', args: `cmd${i}`, status: status as any })
    }
    await r.onCard({ kind: 'assistant', sessionId: 'ses', blocks: [{ type: 'text', text: 'done' }, ...tools.map(t => ({ type: 'tool' as const, tool: t.tool, args: t.args, status: t.status }))], meta: {} })
    const last = bot.sent.at(-1)!
    expect(last.text).toMatch(/cmd2/)
    expect(last.text).toMatch(/cmd4/)
  })

  it('pins running tool into tail (>15 tools, 1 running at pos 0)', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })
    const tools: Array<{ tool: string; args: string; status: 'done' | 'running' }> = []
    for (let i = 0; i < 20; i++) {
      const status = i === 0 ? 'running' : 'done'
      tools.push({ tool: 'bash', args: `cmd${i}`, status: status as any })
    }
    await r.onCard({ kind: 'assistant', sessionId: 'ses', blocks: [{ type: 'text', text: 'done' }, ...tools.map(t => ({ type: 'tool' as const, tool: t.tool, args: t.args, status: t.status }))], meta: {} })
    const last = bot.sent.at(-1)!
    expect(last.text).toMatch(/cmd0/)
    expect(last.text).toMatch(/cmd17/)
  })
})
