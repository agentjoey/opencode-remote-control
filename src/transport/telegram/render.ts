import type { Card } from '../../core/types.js'

export function cardToTelegram(card: Card): {
  text: string
  options: {
    parse_mode: 'HTML'
    reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
  }
} {
  const lines: string[] = []
  if (card.title) {
    lines.push(`<b>${card.title}</b>`)
    lines.push('')
  }
  lines.push(...card.lines)
  if (card.footer) {
    lines.push('')
    lines.push(`<i>${card.footer}</i>`)
  }
  const options: any = { parse_mode: 'HTML' }
  if (card.buttons && card.buttons.length > 0) {
    options.reply_markup = {
      inline_keyboard: card.buttons.map((row) =>
        row.map((b) => ({ text: b.label, callback_data: b.data })),
      ),
    }
  }
  return { text: lines.join('\n'), options }
}
