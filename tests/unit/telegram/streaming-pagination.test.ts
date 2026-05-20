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

// Generate a paragraph that repeats every 200 chars to hit \n\n boundaries
function bigText(lineCount: number): string {
  const lines: string[] = []
  for (let i = 0; i < lineCount; i++) {
    lines.push(`Line ${i} `.repeat(10).trim())
    if (i % 5 === 4) lines.push('')  // paragraph break every 5 lines
  }
  return lines.join('\n')
}

describe('streaming pagination (explosion fix)', () => {
  it('does not explode: sends ≤3 messages for 6000-char stream with boundaries', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })

    const baseText = bigText(300)  // ~200*300/5 ~= 12000 chars raw
    // Trim to roughly 6000 chars
    const text = baseText.slice(0, 6000)

    // Simulate streaming: send deltas incrementally
    let accum = ''
    for (let i = 0; i < text.length; i += 100) {
      accum = text.slice(0, i + 100)
      await r.onCard({ kind: 'streaming', sessionId: 'ses', blocks: [{ type: 'text', text: accum }] })
    }

    // total sendMessage calls should be ≤ 3 (1 thinking + at most 2 pagination chunks)
    expect(bot.sent.length).toBeLessThanOrEqual(3)
  })

  it('each new chunk contains content after the previous cut point', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })

    // Create text that will paginate
    const prefix = 'A'.repeat(3000) + '\n\n'  // boundary
    const suffix = 'B'.repeat(4000)
    const text = prefix + suffix

    // Accumulate past first boundary
    let accum = prefix
    await r.onCard({ kind: 'streaming', sessionId: 'ses', blocks: [{ type: 'text', text: accum }] })

    // Now add suffix - this should trigger pagination at first chunk boundary
    accum = text
    await r.onCard({ kind: 'streaming', sessionId: 'ses', blocks: [{ type: 'text', text: accum }] })

    // Should have 2 sends: thinking + new part
    expect(bot.sent.length).toBeGreaterThanOrEqual(2)

    // The last sent message (new part) should NOT contain the 'A' prefix content
    const lastSent = bot.sent[bot.sent.length - 1]
    expect(lastSent.text).not.toMatch(/AAAA/)
    // It should contain 'B' suffix content
    if (bot.sent.length >= 2) {
      const secondSent = bot.sent[1]
      expect(secondSent.text).toContain('⏳')
    }
  })

  it('finalize continues from chunkStartOffset for remaining content', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })

    // Paginate once — use long enough text to trigger HARD_LIMIT
    const part1 = 'A'.repeat(5000) + '\n\n'
    const part2 = 'final answer here'
    const text = part1 + part2
    let accum = part1
    await r.onCard({ kind: 'streaming', sessionId: 'ses', blocks: [{ type: 'text', text: accum }] })
    accum = text
    await r.onCard({ kind: 'streaming', sessionId: 'ses', blocks: [{ type: 'text', text: accum }] })

    // Now finalize
    await r.onCard({ kind: 'assistant', sessionId: 'ses', blocks: [{ type: 'text', text: text }], meta: { cost: 0.01 } })

    // The last edit (finalize of remaining chunk) should contain the suffix and cost,
    // NOT the AAAA prefix (which was already in Part 1)
    const lastEdit = bot.edits[bot.edits.length - 1]
    expect(lastEdit.text).toContain('final answer here')
    expect(lastEdit.text).toContain('$0.010')
    expect(lastEdit.text).not.toMatch(/A{100,}/)
  })

  it('Stop button is NOT present on the new chunk (Part 2) after pagination', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })

    // Stream enough to trigger pagination
    const part1 = 'A'.repeat(5000) + '\n\n'
    const part2 = 'B'.repeat(1000)
    const text = part1 + part2
    let accum = part1
    await r.onCard({ kind: 'streaming', sessionId: 'ses', blocks: [{ type: 'text', text: accum }] })
    accum = text
    await r.onCard({ kind: 'streaming', sessionId: 'ses', blocks: [{ type: 'text', text: accum }] })

    // The second send (Part 2) should NOT have Stop button
    expect(bot.sent.length).toBe(2)
    const part2Msg = bot.sent[1]
    expect(part2Msg.options.reply_markup).toBeUndefined()
  })

  it('no Part headers appear after pagination', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })

    const part1 = 'A'.repeat(5000) + '\n\n'
    const part2 = 'B'.repeat(500)
    const text = part1 + part2
    let accum = part1
    await r.onCard({ kind: 'streaming', sessionId: 'ses', blocks: [{ type: 'text', text: accum }] })
    accum = text
    await r.onCard({ kind: 'streaming', sessionId: 'ses', blocks: [{ type: 'text', text: accum }] })

    // The new chunk message should be just "⏳", no Part header
    expect(bot.sent.length).toBe(2)
    expect(bot.sent[1].text).toBe('⏳')
    expect(bot.sent[1].text).not.toContain('Part')
  })

  it('finalize pieces have no Part headers', async () => {
    const bot = fakeBot()
    const r = new TelegramSessionRenderer({ chatId: '100', sessionId: 'ses', bot: bot as any })
    await r.onCard({ kind: 'thinking', sessionId: 'ses', showStop: true })

    const longText = ('B'.repeat(2000) + '\n\n').repeat(5)
    await r.onCard({ kind: 'assistant', sessionId: 'ses', blocks: [{ type: 'text', text: longText }], meta: { cost: 0.01 } })

    const partTexts = [...bot.edits.map((e: any) => e.text), ...bot.sent.map((s: any) => s.text)]
    for (const t of partTexts) {
      expect(t).not.toContain('Part ')
    }
  })
})
