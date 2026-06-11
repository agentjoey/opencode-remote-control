import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { registerCreateSession } from '../../../src/transport/web/routes/create-session'

describe('POST /api/session', () => {
  it('creates a session in the given directory and returns its id', async () => {
    const create = vi.fn(async ({ query, body }: any) => ({ data: { id: 'ses_new', directory: query.directory, title: body?.title } }))
    const client = { session: { create } } as any
    const app = new Hono()
    registerCreateSession(app, client)
    const res = await app.request('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory: '/Users/x/repo', title: 'Hi' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'ses_new' })
    expect(create).toHaveBeenCalledWith({ query: { directory: '/Users/x/repo' }, body: { title: 'Hi' } })
  })

  it('400s without a directory', async () => {
    const app = new Hono()
    registerCreateSession(app, { session: { create: vi.fn() } } as any)
    const res = await app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(400)
  })
})
