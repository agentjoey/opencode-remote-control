import type { Card } from '../../core/types.js'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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
  lines.push(...card.lines.map(escapeHtml))
  if (card.footer) {
    lines.push('')
    lines.push(`<i>${escapeHtml(card.footer)}</i>`)
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
