import type { Hono } from 'hono'
import type { BackendRegistry } from '../../../core/agent/registry.js'

export function registerCommands(app: Hono, reg: BackendRegistry) {
  app.get('/api/commands', async (c) => {
    const b = reg.get(c.req.query('backend') ?? '') ?? reg.active()
    return c.json(await b.listCommands())
  })
  app.post('/api/command', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { sessionId?: string; command?: string; arguments?: string }
    if (!body.sessionId || !body.command) return c.json({ error: 'sessionId and command required' }, 400)
    await reg.forSession(body.sessionId).runCommand(body.sessionId, body.command, body.arguments)
    return c.json({ ok: true })
  })
}
