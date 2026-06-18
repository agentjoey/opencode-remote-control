import type { Hono } from 'hono'
import type { BackendRegistry } from '../../../core/agent/registry.js'

export function registerDiff(app: Hono, reg: BackendRegistry) {
  app.get('/api/session/:id/diff', async (c) => {
    const id = c.req.param('id')
    return c.json(await reg.forSession(id).getDiff(id))
  })
}
