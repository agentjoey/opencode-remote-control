// src/lib/auth-token.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readTokenFromHash, captureToken, getToken, setToken } from './auth-token.js'

beforeEach(() => { localStorage.clear() })

describe('readTokenFromHash', () => {
  it('parses #token=abc', () => {
    expect(readTokenFromHash('#token=abc123')).toBe('abc123')
  })
  it('parses token among other fragment params', () => {
    expect(readTokenFromHash('#foo=1&token=abc')).toBe('abc')
  })
  it('url-decodes the value', () => {
    expect(readTokenFromHash('#token=a%2Bb')).toBe('a+b')
  })
  it('returns null when absent or empty', () => {
    expect(readTokenFromHash('')).toBeNull()
    expect(readTokenFromHash('#')).toBeNull()
    expect(readTokenFromHash('#other=1')).toBeNull()
    expect(readTokenFromHash('#token=')).toBeNull()
  })
})

describe('captureToken', () => {
  function fakeLoc(hash: string): Location {
    return { hash, pathname: '/', search: '' } as Location
  }

  it('persists a fragment token and strips the fragment', () => {
    const replaceState = vi.fn()
    const tok = captureToken(fakeLoc('#token=secret'), { replaceState } as unknown as History)
    expect(tok).toBe('secret')
    expect(getToken()).toBe('secret')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('preserves the query string when stripping the fragment', () => {
    const replaceState = vi.fn()
    const loc = { hash: '#token=t', pathname: '/x', search: '?a=1' } as Location
    captureToken(loc, { replaceState } as unknown as History)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/x?a=1')
  })

  it('falls back to the stored token when no fragment', () => {
    setToken('stored')
    const tok = captureToken(fakeLoc(''), { replaceState: vi.fn() } as unknown as History)
    expect(tok).toBe('stored')
  })

  it('returns null when neither fragment nor storage has a token', () => {
    expect(captureToken(fakeLoc(''), { replaceState: vi.fn() } as unknown as History)).toBeNull()
  })
})
