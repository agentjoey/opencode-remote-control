import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { registerWorkspaces } from '../../../src/transport/web/routes/workspaces'

describe('GET /api/workspaces', () => {
  it('returns workspaces from the callback', async () => {
    const listWorkspaces = async () => [
      { directory: '/Users/x/repo', name: 'repo', sessionCount: 1, lastActiveAt: 1 },
    ]
    const app = new Hono()
    registerWorkspaces(app, listWorkspaces)
    const res = await app.request('/api/workspaces')
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body.some((w) => w.directory === '/Users/x/repo' && w.name === 'repo')).toBe(true)
  })

  it('still returns 200 when no listWorkspaces is provided', async () => {
    const app = new Hono()
    registerWorkspaces(app, undefined)
    const res = await app.request('/api/workspaces')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})
