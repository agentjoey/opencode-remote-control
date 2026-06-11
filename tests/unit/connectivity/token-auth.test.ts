import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateToken, createTokenAuth } from '../../../src/connectivity/auth/token'

const tmp = mkdtempSync(join(tmpdir(), 'oprc-token-'))

describe('loadOrCreateToken', () => {
  it('returns an explicit token verbatim', () => {
    expect(loadOrCreateToken({ token: 'abc123' })).toBe('abc123')
  })
  it('generates and persists a token when none exists, then reuses it', () => {
    const path = join(tmp, 'tok')
    const a = loadOrCreateToken({ tokenPath: path })
    expect(a.length).toBeGreaterThan(20)
    expect(readFileSync(path, 'utf-8').trim()).toBe(a)
    const b = loadOrCreateToken({ tokenPath: path })
    expect(b).toBe(a) // reused, not regenerated
  })
  it('reads an existing token file', () => {
    const path = join(tmp, 'tok2')
    writeFileSync(path, 'preset-token\n')
    expect(loadOrCreateToken({ tokenPath: path })).toBe('preset-token')
  })
})

describe('createTokenAuth.verifyUpgrade', () => {
  const auth = createTokenAuth({ token: 'secret', devEmail: 'me@local' })

  it('accepts the token via ?token= query', async () => {
    const u = await auth.verifyUpgrade({ headers: {}, url: '/ws?token=secret' })
    expect(u).toEqual({ email: 'me@local', sub: 'token' })
  })
  it('accepts the token via ocrc_token cookie', async () => {
    const u = await auth.verifyUpgrade({ headers: { cookie: 'x=1; ocrc_token=secret' } })
    expect(u?.email).toBe('me@local')
  })
  it('rejects a wrong token', async () => {
    expect(await auth.verifyUpgrade({ headers: {}, url: '/ws?token=nope' })).toBeNull()
  })
  it('rejects when no token present', async () => {
    expect(await auth.verifyUpgrade({ headers: {} })).toBeNull()
  })
  it('allows a loopback peer when devBypass is on', async () => {
    const a2 = createTokenAuth({ token: 'secret', devBypass: true, devEmail: 'd@local' })
    const u = await a2.verifyUpgrade({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })
    expect(u?.email).toBe('d@local')
  })
})
