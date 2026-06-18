import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { singleBackendRegistry } from '../../../src/core/agent/registry'
import { registerCreateSession } from '../../../src/transport/web/routes/create-session'

describe('POST /api/session', () => {
  it('creates a session in the given directory and returns its id', async () => {
    const createSession = vi.fn(async ({ directory, title }: any) => ({ id: 'ses_new' }))
    const backend = { createSession } as any
    const app = new Hono()
    registerCreateSession(app, singleBackendRegistry(backend))
    const res = await app.request('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory: '/Users/x/repo', title: 'Hi' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'ses_new' })
    expect(createSession).toHaveBeenCalledWith({ directory: '/Users/x/repo', title: 'Hi' })
  })

  it('400s without a directory on a workspace-capable backend', async () => {
    const app = new Hono()
    registerCreateSession(app, singleBackendRegistry({ id: 'opencode', createSession: vi.fn(), capabilities: { workspaces: true } } as any))
    const res = await app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(400)
  })

  it('allows an empty directory when the backend does not enumerate workspaces (ACP)', async () => {
    const createSession = vi.fn(async () => ({ id: 'ses_acp' }))
    const app = new Hono()
    registerCreateSession(app, singleBackendRegistry({ id: 'acp:kimi', createSession, capabilities: { workspaces: false } } as any))
    const res = await app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(200)
    expect(createSession).toHaveBeenCalledWith({ directory: '', title: undefined })
  })

  it('omits title → createSession receives undefined title', async () => {
    const createSession = vi.fn(async () => ({ id: 'ses_x' }))
    const app = new Hono()
    registerCreateSession(app, singleBackendRegistry({ createSession } as any))
    const res = await app.request('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directory: '/Users/x/repo' }),
    })
    expect(res.status).toBe(200)
    expect(createSession).toHaveBeenCalledWith({ directory: '/Users/x/repo', title: undefined })
  })
})
