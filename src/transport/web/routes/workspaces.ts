import type { Hono } from 'hono'
import type { BackendRegistry } from '../../../core/agent/registry.js'

export function registerWorkspaces(app: Hono, reg: BackendRegistry) {
  app.get('/api/workspaces', async (c) => {
    const b = reg.get(c.req.query('backend') ?? '') ?? reg.active()
    return c.json(await b.listWorkspaces())
  })
}
