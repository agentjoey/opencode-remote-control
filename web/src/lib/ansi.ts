const FG: Record<number, string> = {
  30: '#555', 31: '#e0796b', 32: '#6cc08b', 33: '#e0b341',
  34: '#7cafc2', 35: '#b48cf0', 36: '#4ec9b0', 37: '#f2f0ec',
  90: '#8d877c', 91: '#f09080', 92: '#8dd8a4', 93: '#f0c860',
  94: '#90c5dd', 95: '#c9a8f8', 96: '#70dcc8', 97: '#ffffff',
}

export function ansiToHtml(raw: string): string {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  s = s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, (m) => (m.endsWith('m') ? m : ''))

  let open = 0
  const out: string[] = []

  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/)
    if (!m) { out.push(part); continue }

    const codes = m[1].split(';').filter(Boolean).map(Number)
    if (codes.length === 0 || codes.includes(0)) {
      while (open > 0) { out.push('</span>'); open-- }
      continue
    }

    const css: string[] = []
    for (const c of codes) {
      if (c === 1) css.push('font-weight:bold')
      else if (c === 2) css.push('opacity:0.7')
      else if (c === 3) css.push('font-style:italic')
      else if (c === 4) css.push('text-decoration:underline')
      else if (FG[c]) css.push(`color:${FG[c]}`)
    }

    if (css.length) {
      out.push(`<span style="${css.join(';')}">`)
      open++
    }
  }

  while (open > 0) { out.push('</span>'); open-- }
  return out.join('')
}

export function stripAnsi(raw: string): string {
  return raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
}
