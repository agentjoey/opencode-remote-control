import type { Hono } from 'hono'
import type { AgentBackend } from '../../../core/agent/backend.js'

export function registerMcp(app: Hono, backend: AgentBackend) {
  app.get('/api/mcp', async (c) => {
    return c.json(await backend.getMcp())
  })
}
