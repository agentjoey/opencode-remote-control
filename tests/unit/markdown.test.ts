import { describe, it, expect } from 'vitest'
import { escapeMarkdownV2, chunkMessage } from '../../src/utils/markdown'

describe('escapeMarkdownV2', () => {
  it('escapes all MarkdownV2 reserved characters', () => {
    const input = 'hello _*[]()~`>#+-=|{}.!\\world'
    const escaped = escapeMarkdownV2(input)
    // Every reserved char must be preceded by a backslash
    expect(escaped).toBe('hello \\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\world')
  })

  it('leaves regular text alone', () => {
    expect(escapeMarkdownV2('plain text 123')).toBe('plain text 123')
  })

  it('handles empty string', () => {
    expect(escapeMarkdownV2('')).toBe('')
  })
})

describe('chunkMessage', () => {
  it('returns single chunk when text fits', () => {
    expect(chunkMessage('short', 100)).toEqual(['short'])
  })

  it('splits on newlines preferentially', () => {
    const text = 'aaa\nbbb\nccc'
    const chunks = chunkMessage(text, 5)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toContain('aaa')
    expect(chunks.join('')).toContain('bbb')
    expect(chunks.join('')).toContain('ccc')
  })

  it('hard-splits a single line longer than maxLength', () => {
    const text = 'a'.repeat(15)
    const chunks = chunkMessage(text, 5)
    expect(chunks).toEqual(['aaaaa', 'aaaaa', 'aaaaa'])
  })

  it('uses default 4000 when maxLength omitted', () => {
    const text = 'x'.repeat(8000)
    const chunks = chunkMessage(text)
    expect(chunks.length).toBe(2)
    expect(chunks[0].length).toBe(4000)
  })
})
