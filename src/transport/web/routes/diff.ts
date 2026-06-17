import type { Hono } from 'hono'
import type { AgentBackend } from '../../../core/agent/backend.js'

export function registerDiff(app: Hono, backend: AgentBackend) {
  app.get('/api/session/:id/diff', async (c) => {
    const id = c.req.param('id')
    return c.json(await backend.getDiff(id))
  })
}
