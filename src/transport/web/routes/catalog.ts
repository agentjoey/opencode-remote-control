import type { Hono } from 'hono'
import type { AgentBackend } from '../../../core/agent/backend.js'

export function registerCatalog(app: Hono, backend: AgentBackend) {
  app.get('/api/agents', async (c) => {
    return c.json(await backend.getAgents())
  })

  app.get('/api/models', async (c) => {
    return c.json(await backend.getModels())
  })
}
