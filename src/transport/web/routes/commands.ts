import type { Hono } from 'hono'
import type { AgentBackend } from '../../../core/agent/backend.js'

export function registerCommands(app: Hono, backend: AgentBackend) {
  app.get('/api/commands', async (c) => {
    return c.json(await backend.listCommands())
  })
  app.post('/api/command', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { sessionId?: string; command?: string; arguments?: string }
    if (!body.sessionId || !body.command) return c.json({ error: 'sessionId and command required' }, 400)
    await backend.runCommand(body.sessionId, body.command, body.arguments)
    return c.json({ ok: true })
  })
}
