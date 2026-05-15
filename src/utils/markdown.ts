const MD_V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g

export function escapeMarkdownV2(text: string): string {
  return text.replace(MD_V2_SPECIAL, '\\$&')
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
