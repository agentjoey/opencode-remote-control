import type { Hono } from 'hono'
import type { AgentBackend } from '../../../core/agent/backend.js'

export function registerRename(app: Hono, backend: AgentBackend) {
  app.post('/api/sessions/:id/rename', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({})) as { title?: string }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return c.json({ error: 'title required' }, 400)
    await backend.renameSession(id, title)
    return c.json({ ok: true })
  })
}
