import type { Hono } from 'hono'
import type { BackendRegistry } from '../../../core/agent/registry.js'

export function registerCatalog(app: Hono, reg: BackendRegistry) {
  app.get('/api/agents', async (c) => {
    const b = reg.get(c.req.query('backend') ?? '') ?? reg.active()
    return c.json(await b.getAgents())
  })
  app.get('/api/models', async (c) => {
    const b = reg.get(c.req.query('backend') ?? '') ?? reg.active()
    return c.json(await b.getModels())
  })
}
