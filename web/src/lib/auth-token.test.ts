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

  it('persists a fragment token AND keeps it in the URL (iOS home-screen needs the bookmarked URL)', () => {
    const loc = fakeLoc('#token=secret')
    const tok = captureToken(loc)
    expect(tok).toBe('secret')
    expect(getToken()).toBe('secret')
    expect(loc.hash).toBe('#token=secret') // not stripped
  })

  it('falls back to the stored token when no fragment', () => {
    setToken('stored')
    expect(captureToken(fakeLoc(''))).toBe('stored')
  })

  it('returns null when neither fragment nor storage has a token', () => {
    expect(captureToken(fakeLoc(''))).toBeNull()
  })
})
