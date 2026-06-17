import type { Hono } from 'hono'
import type { AgentBackend } from '../../../core/agent/backend.js'

export function registerWorkspaces(app: Hono, backend: AgentBackend) {
  app.get('/api/workspaces', async (c) => {
    return c.json(await backend.listWorkspaces())
  })
}
