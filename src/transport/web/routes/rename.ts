import type { Hono } from 'hono'
import type { BackendRegistry } from '../../../core/agent/registry.js'

export function registerRename(app: Hono, reg: BackendRegistry) {
  app.post('/api/sessions/:id/rename', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({})) as { title?: string }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return c.json({ error: 'title required' }, 400)
    await reg.forSession(id).renameSession(id, title)
    return c.json({ ok: true })
  })
}
