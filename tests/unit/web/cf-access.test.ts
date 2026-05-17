import { describe, it, expect, vi } from 'vitest'
import { cfAccessMiddleware } from '../../../src/transport/web/middleware/cf-access'

vi.mock('jose', async () => {
  const actual = await vi.importActual<typeof import('jose')>('jose')
  return {
    ...actual,
    createRemoteJWKSet: vi.fn().mockReturnValue({}),
    jwtVerify: vi.fn(),
  }
})

import { jwtVerify, createRemoteJWKSet } from 'jose'

describe('cfAccessMiddleware', () => {
  it('rejects request without token', async () => {
    const mw = cfAccessMiddleware({ team: 'test', aud: 'app' })
    const c = { req: { header: () => undefined, query: () => undefined }, env: () => undefined, set: vi.fn(), json: vi.fn(), header: vi.fn() } as any
    const next = vi.fn()
    await mw(c, next)
    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }), 401)
  })

  it('accepts valid JWT header', async () => {
    const mw = cfAccessMiddleware({ team: 'test', aud: 'app' })
    const c = { req: { header: (n: string) => n === 'cf-access-jwt-assertion' ? 'valid-jwt' : undefined, query: () => undefined }, env: () => undefined, set: vi.fn(), json: vi.fn(), header: vi.fn() } as any
    const next = vi.fn()
    ;(jwtVerify as any).mockResolvedValue({ payload: { email: 'u@example.com', sub: '123' } })
    await mw(c, next)
    expect(next).toHaveBeenCalled()
    expect(c.set).toHaveBeenCalledWith('user', { email: 'u@example.com', sub: '123' })
  })

  it('rejects invalid JWT', async () => {
    const mw = cfAccessMiddleware({ team: 'test', aud: 'app' })
    const c = { req: { header: (n: string) => n === 'cf-access-jwt-assertion' ? 'bad-jwt' : undefined, query: () => undefined }, env: () => undefined, set: vi.fn(), json: vi.fn(), header: vi.fn() } as any
    const next = vi.fn()
    ;(jwtVerify as any).mockRejectedValue(new Error('bad token'))
    await mw(c, next)
    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }), 401)
  })

  it('dev bypass works on loopback host', async () => {
    const mw = cfAccessMiddleware({ team: 'test', aud: 'app', devBypass: true, devEmail: 'dev@local', host: '127.0.0.1' })
    const c = { req: { header: () => undefined, query: () => undefined }, env: () => undefined, set: vi.fn(), json: vi.fn(), header: vi.fn() } as any
    const next = vi.fn()
    await mw(c, next)
    expect(next).toHaveBeenCalled()
    expect(c.set).toHaveBeenCalledWith('user', { email: 'dev@local', sub: 'dev' })
  })

  it('dev bypass ignored on non-loopback host', async () => {
    const mw = cfAccessMiddleware({ team: 'test', aud: 'app', devBypass: true, devEmail: 'dev@local', host: 'example.com' })
    const c = { req: { header: () => undefined, query: () => undefined }, env: () => undefined, set: vi.fn(), json: vi.fn(), header: vi.fn() } as any
    const next = vi.fn()
    await mw(c, next)
    expect(next).not.toHaveBeenCalled()
    expect(c.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }), 401)
  })
})
