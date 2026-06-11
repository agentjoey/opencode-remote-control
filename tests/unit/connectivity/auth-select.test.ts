import { describe, it, expect } from 'vitest'
import { selectAuthStrategy } from '../../../src/connectivity/auth/select'

describe('selectAuthStrategy', () => {
  it('returns a token strategy by default', () => {
    const a = selectAuthStrategy({ mode: 'token', token: 'x', devEmail: 'e@l' })
    expect(typeof a.httpMiddleware).toBe('function')
    expect(typeof a.verifyUpgrade).toBe('function')
  })
  it('returns a cf-access strategy when mode is cf-access', () => {
    const a = selectAuthStrategy({ mode: 'cf-access', cfAccess: { team: 't', aud: 'a' } })
    expect(typeof a.httpMiddleware).toBe('function')
    expect(typeof a.verifyUpgrade).toBe('function')
  })
})
