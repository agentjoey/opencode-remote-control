import type { Hono } from 'hono'
import type { BackendRegistry } from '../../../core/agent/registry.js'

export function registerTodo(app: Hono, reg: BackendRegistry) {
  app.get('/api/session/:id/todo', async (c) => {
    const id = c.req.param('id')
    return c.json(await reg.forSession(id).getTodos(id))
  })
}
