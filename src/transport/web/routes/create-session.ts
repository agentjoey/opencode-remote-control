import type { Hono } from 'hono'
import type { AgentBackend } from '../../../core/agent/backend.js'

export function registerCreateSession(app: Hono, backend: AgentBackend) {
  app.post('/api/session', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { directory?: string; title?: string }
    const directory = typeof body.directory === 'string' ? body.directory.trim() : ''
    // Backends that don't enumerate workspaces (e.g. ACP) create in their own
    // default working directory — the directory is optional there.
    if (!directory && backend.capabilities.workspaces) {
      return c.json({ error: 'directory required' }, 400)
    }
    try {
      const { id } = await backend.createSession({ directory, title: body.title })
      return c.json({ id })
    } catch {
      return c.json({ error: 'create failed' }, 500)
    }
  })
}
