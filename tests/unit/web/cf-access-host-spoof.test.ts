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

describe('CF-Access Host header spoofing prevention', () => {
  // ── verifyUpgradeJwt ──

  it('rejects spoofed Host header (127.0.0.1) when socket is remote', async () => {
    // devBypass enabled, host set to non-loopback, socket remote
    const user = await verifyUpgradeJwt(
      {
        headers: { host: '127.0.0.1:7081' },
        socket: { remoteAddress: '10.0.0.5' },
      },
      { team: 'test', aud: 'app', devBypass: true, host: '0.0.0.0' },
    )
    // Should NOT be bypassed — Host header spoof is ignored, socket is not loopback
    expect(user).toBeNull()
  })

  it('rejects spoofed Host header (localhost) when socket is remote', async () => {
    const user = await verifyUpgradeJwt(
      {
        headers: { host: 'localhost:7081' },
        socket: { remoteAddress: '192.168.1.100' },
      },
      { team: 'test', aud: 'app', devBypass: true, host: '0.0.0.0' },
    )
    expect(user).toBeNull()
  })

  it('allows legitimate loopback connection (socket 127.0.0.1)', async () => {
    const user = await verifyUpgradeJwt(
      {
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      },
      { team: 'test', aud: 'app', devBypass: true },
    )
    expect(user).not.toBeNull()
    expect(user!.email).toBe('dev@localhost')
  })

  it('allows legitimate IPv6 loopback connection (socket ::1)', async () => {
    const user = await verifyUpgradeJwt(
      {
        headers: {},
        socket: { remoteAddress: '::1' },
      },
      { team: 'test', aud: 'app', devBypass: true },
    )
    expect(user).not.toBeNull()
    expect(user!.email).toBe('dev@localhost')
  })

  it('allows legitimate IPv4-mapped loopback (::ffff:127.0.0.1)', async () => {
    const user = await verifyUpgradeJwt(
      {
        headers: {},
        socket: { remoteAddress: '::ffff:127.0.0.1' },
      },
      { team: 'test', aud: 'app', devBypass: true },
    )
    expect(user).not.toBeNull()
    expect(user!.email).toBe('dev@localhost')
  })

  it('ignores opts.host even when set to loopback if the peer is remote', async () => {
    // opts.host is the server's own bind address — it must NOT grant bypass.
    // Behind a tunnel the peer is 127.0.0.1 while the real client is remote;
    // trusting opts.host (or a loopback bind) would defeat CF Access entirely.
    const user = await verifyUpgradeJwt(
      {
        headers: {},
        socket: { remoteAddress: '10.0.0.5' },
      },
      { team: 'test', aud: 'app', devBypass: true, host: '127.0.0.1' },
    )
    expect(user).toBeNull()
  })

  // ── Normal JWT flow (devBypass off) ──

  it('requires valid JWT when devBypass is off, even on loopback socket', async () => {
    const user = await verifyUpgradeJwt(
      {
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      },
      { team: 'test', aud: 'app', devBypass: false },
    )
    expect(user).toBeNull()
  })

  it('accepts valid JWT when devBypass is off', async () => {
    ;(jwtVerify as any).mockResolvedValue({ payload: { email: 'user@test.com', sub: 'sub1' } })
    const user = await verifyUpgradeJwt(
      {
        headers: { 'cf-access-jwt-assertion': 'valid-jwt' },
      },
      { team: 'test', aud: 'app', devBypass: false },
    )
    expect(user).not.toBeNull()
    expect(user!.email).toBe('user@test.com')
  })
})
