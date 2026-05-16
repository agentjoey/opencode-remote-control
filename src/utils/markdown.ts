const MD_V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g

export function escapeMarkdownV2(text: string): string {
  return text.replace(MD_V2_SPECIAL, '\\$&')
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Convert Markdown to Telegram HTML (parse_mode: 'HTML').
 * Handles: fenced code blocks, inline code, bold, italic, strikethrough,
 * headings, unordered/ordered lists, blockquotes, horizontal rules, links.
 */
export function markdownToTelegramHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inFence = false
  let fenceLang = ''
  let fenceLines: string[] = []

  for (const line of lines) {
    if (!inFence) {
      const fm = line.match(/^```([\w-]*)/)
      if (fm) {
        inFence = true
        fenceLang = fm[1] ?? ''
        fenceLines = []
        continue
      }
    } else {
      if (line === '```' || line.startsWith('```')) {
        const cls = fenceLang ? ` class="language-${escHtml(fenceLang)}"` : ''
        out.push(`<pre><code${cls}>${escHtml(fenceLines.join('\n'))}</code></pre>`)
        inFence = false
        fenceLang = ''
        fenceLines = []
      } else {
        fenceLines.push(line)
      }
      continue
    }

    // Horizontal rule
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push('──────────')
      continue
    }

    // Heading (# ## ###)
    const hm = line.match(/^#{1,6} (.+)/)
    if (hm) {
      out.push(`<b>${processInline(hm[1])}</b>`)
      continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      out.push(`<blockquote>${processInline(line.slice(2))}</blockquote>`)
      continue
    }

    // Unordered list
    if (/^[*\-] /.test(line)) {
      out.push('  • ' + processInline(line.slice(2)))
      continue
    }

    // Ordered list
    const olm = line.match(/^(\d+\.) (.*)/)
    if (olm) {
      out.push(`${olm[1]} ${processInline(olm[2])}`)
      continue
    }

    out.push(processInline(line))
  }

  // Unclosed fence — dump as code
  if (inFence && fenceLines.length > 0) {
    const cls = fenceLang ? ` class="language-${escHtml(fenceLang)}"` : ''
    out.push(`<pre><code${cls}>${escHtml(fenceLines.join('\n'))}</code></pre>`)
  }

  return out.join('\n')
}

function processInline(text: string): string {
  const stash: string[] = []
  const ph = (html: string): string => { stash.push(html); return `\x00${stash.length - 1}\x00` }

  let s = text

  // Inline code → stash (protect from further transforms)
  s = s.replace(/`([^`\n]+)`/g, (_, c) => ph(`<code>${escHtml(c)}</code>`))

  // Links → stash
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, t, url) => ph(`<a href="${escHtml(url)}">${escHtml(t)}</a>`))

  // Escape remaining HTML chars
  s = s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))

  // Bold — must come before italic to handle **
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  s = s.replace(/__(.+?)__/g, '<b>$1</b>')

  // Italic — avoid matching inside **bold**
  s = s.replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
  s = s.replace(/(?<![_])_([^_\n]+)_(?![_])/g, '<i>$1</i>')

  // Strikethrough
  s = s.replace(/~~(.+?)~~/g, '<s>$1</s>')

  // Restore stash
  return s.replace(/\x00(\d+)\x00/g, (_, i) => stash[+i])
}

export function chunkMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let current = ''

  for (const line of text.split('\n')) {
    // Hard-split lines longer than maxLength
    if (line.length > maxLength) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.slice(i, i + maxLength))
      }
      continue
    }

    const candidate = current ? current + '\n' + line : line
    if (candidate.length > maxLength) {
      chunks.push(current)
      current = line
    } else {
      current = candidate
    }
  }

  if (current) chunks.push(current)
  return chunks
}
