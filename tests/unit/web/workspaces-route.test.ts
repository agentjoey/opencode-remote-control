import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { registerWorkspaces } from '../../../src/transport/web/routes/workspaces'

describe('GET /api/workspaces', () => {
  it('returns workspaces from the client', async () => {
    const client = {
      project: { list: async () => ({ data: [{ worktree: '/Users/x/repo' }] }) },
      session: { list: async () => ({ data: [{ id: 's1', directory: '/Users/x/repo', time: { updated: 1 } }] }) },
    } as any
    const app = new Hono()
    registerWorkspaces(app, client)
    const res = await app.request('/api/workspaces')
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body.some((w) => w.directory === '/Users/x/repo' && w.name === 'repo')).toBe(true)
  })

  it('still returns 200 when project.list fails (best-effort)', async () => {
    const client = {
      project: { list: async () => { throw new Error('boom') } },
      session: { list: async () => ({ data: [] }) },
    } as any
    const app = new Hono()
    registerWorkspaces(app, client)
    const res = await app.request('/api/workspaces')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})
