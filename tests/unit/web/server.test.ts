import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { buildServer } from '../../../src/transport/web/server'

describe('buildServer', () => {
  it('GET /api/me returns user email with dev bypass', async () => {
    const app = buildServer({
      cfAccess: { team: 'test', aud: 'app', devBypass: true, devEmail: 'dev@local' },
      client: {} as any,
      state: {} as any,
      cardBus: {} as any,
      wsHub: { subscribe: vi.fn(), broadcast: vi.fn() },
      cacheSize: 100,
    })
    const res = await app.request('/api/me')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe('dev@local')
  })

  it('GET /api/me returns 401 without auth', async () => {
    const app = buildServer({
      cfAccess: { team: 'test', aud: 'app', devBypass: false },
      client: {} as any,
      state: {} as any,
      cardBus: {} as any,
      wsHub: { subscribe: vi.fn(), broadcast: vi.fn() },
      cacheSize: 100,
    })
    const res = await app.request('/api/me')
    expect(res.status).toBe(401)
  })
})
