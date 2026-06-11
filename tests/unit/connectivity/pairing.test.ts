import { describe, it, expect } from 'vitest'
import { buildPairUrl, buildPairCard, buildPairContext } from '../../../src/connectivity/pairing'

describe('buildPairUrl', () => {
  it('encodes the token in the URL fragment (never the query)', () => {
    expect(buildPairUrl('https://ocrc.example.com', 'tok-123')).toBe('https://ocrc.example.com/#token=tok-123')
  })
  it('strips a trailing slash on the base', () => {
    expect(buildPairUrl('https://h/', 'abc')).toBe('https://h/#token=abc')
  })
  it('url-encodes special chars in the token', () => {
    expect(buildPairUrl('https://h', 'a/b+c')).toBe('https://h/#token=a%2Fb%2Bc')
  })
})

describe('buildPairCard', () => {
  it('produces the URL, a rendered QR, and human lines', async () => {
    const card = await buildPairCard('https://ocrc.example.com', 'supersecrettoken')
    expect(card.url).toBe('https://ocrc.example.com/#token=supersecrettoken')
    expect(card.qr.length).toBeGreaterThan(0)
    expect(card.lines.join('\n')).toContain('ocrc.example.com')
  })
})

describe('buildPairContext', () => {
  it('reads token + public url from env', async () => {
    const prevUrl = process.env.WEB_PUBLIC_URL
    const prevTok = process.env.WEB_TOKEN
    process.env.WEB_PUBLIC_URL = 'https://x.example.com'
    process.env.WEB_TOKEN = 'envtok'
    try {
      const { token, url } = await buildPairContext()
      expect(token).toBe('envtok')
      expect(url).toBe('https://x.example.com')
    } finally {
      if (prevUrl === undefined) delete process.env.WEB_PUBLIC_URL; else process.env.WEB_PUBLIC_URL = prevUrl
      if (prevTok === undefined) delete process.env.WEB_TOKEN; else process.env.WEB_TOKEN = prevTok
    }
  })
})
