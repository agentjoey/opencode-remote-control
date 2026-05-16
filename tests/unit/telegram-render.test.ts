import { describe, it, expect } from 'vitest'
import { cardToTelegram } from '../../src/transport/telegram/render'

describe('cardToTelegram', () => {
  it('renders title + lines', () => {
    const out = cardToTelegram({ title: '🤖 Agent', lines: ['build', 'plan'] })
    expect(out.text).toBe('<b>🤖 Agent</b>\n\nbuild\nplan')
    expect(out.options.parse_mode).toBe('HTML')
  })

  it('renders footer in italic', () => {
    const out = cardToTelegram({ title: 'T', lines: ['x'], footer: 'note' })
    expect(out.text).toBe('<b>T</b>\n\nx\n\n──────────\n<i>note</i>')
  })

  it('renders 2D buttons as inline keyboard rows', () => {
    const out = cardToTelegram({
      lines: ['hi'],
      buttons: [
        [{ label: 'A', data: 'a' }, { label: 'B', data: 'b' }],
        [{ label: 'C', data: 'c' }],
      ],
    })
    const kb = (out.options.reply_markup as any).inline_keyboard
    expect(kb).toEqual([
      [{ text: 'A', callback_data: 'a' }, { text: 'B', callback_data: 'b' }],
      [{ text: 'C', callback_data: 'c' }],
    ])
  })

  it('omits keyboard when buttons absent', () => {
    const out = cardToTelegram({ lines: ['hi'] })
    expect(out.options.reply_markup).toBeUndefined()
  })
})
