import { describe, it, expect, vi } from 'vitest'
import { verifyUpgradeJwt } from '../../../src/transport/web/middleware/cf-access'

vi.mock('jose', async () => {
  const actual = await vi.importActual<typeof import('jose')>('jose')
  return {
    ...actual,
    createRemoteJWKSet: vi.fn().mockReturnValue({}),
    jwtVerify: vi.fn(),
  }
})

import { jwtVerify } from 'jose'

describe('verifyUpgradeJwt', () => {
  it('rejects request without token', async () => {
    const user = await verifyUpgradeJwt(
      { headers: {} },
      { team: 'test', aud: 'app' },
    )
    expect(user).toBeNull()
  })

  it('rejects invalid JWT', async () => {
    ;(jwtVerify as any).mockRejectedValue(new Error('bad token'))
    const user = await verifyUpgradeJwt(
      { headers: { 'cf-access-jwt-assertion': 'bad-jwt' } },
      { team: 'test', aud: 'app' },
    )
    expect(user).toBeNull()
  })

  it('accepts valid JWT header', async () => {
    ; (jwtVerify as any).mockResolvedValue({ payload: { email: 'u@example.com', sub: '123' } })
    const user = await verifyUpgradeJwt(
      { headers: { 'cf-access-jwt-assertion': 'valid-jwt' } },
      { team: 'test', aud: 'app' },
    )
    expect(user).toEqual({ email: 'u@example.com', sub: '123' })
  })

  it('dev bypass works on loopback host', async () => {
    const user = await verifyUpgradeJwt(
      { headers: {} },
      { team: 'test', aud: 'app', devBypass: true, devEmail: 'dev@local', host: '127.0.0.1' },
    )
    expect(user).toEqual({ email: 'dev@local', sub: 'dev' })
  })

  it('dev bypass ignored on non-loopback host', async () => {
    const user = await verifyUpgradeJwt(
      { headers: {} },
      { team: 'test', aud: 'app', devBypass: true, devEmail: 'dev@local', host: 'example.com' },
    )
    expect(user).toBeNull()
  })

  it('extracts JWT from query string', async () => {
    ; (jwtVerify as any).mockResolvedValue({ payload: { email: 'u@example.com', sub: '123' } })
    const user = await verifyUpgradeJwt(
      { headers: {}, url: '/ws?cf_access_jwt=query-jwt' },
      { team: 'test', aud: 'app' },
    )
    expect(user).toEqual({ email: 'u@example.com', sub: '123' })
    expect(jwtVerify).toHaveBeenCalledWith('query-jwt', expect.anything(), expect.anything())
  })

  it('extracts JWT from cookie', async () => {
    ; (jwtVerify as any).mockResolvedValue({ payload: { email: 'u@example.com', sub: '123' } })
    const user = await verifyUpgradeJwt(
      { headers: { cookie: 'CF_Authorization=cookie-jwt; other=1' } },
      { team: 'test', aud: 'app' },
    )
    expect(user).toEqual({ email: 'u@example.com', sub: '123' })
    expect(jwtVerify).toHaveBeenCalledWith('cookie-jwt', expect.anything(), expect.anything())
  })
})
