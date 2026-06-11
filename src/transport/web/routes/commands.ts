import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'

export function registerCommands(app: Hono, client: OpencodeClient) {
  app.get('/api/commands', async (c) => {
    const res = await client.command.list()
    const data = (res.data ?? []) as Array<{ name: string; description?: string }>
    return c.json(data.map((d) => ({ name: d.name, description: d.description ?? '' })))
  })
  app.post('/api/command', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { sessionId?: string; command?: string; arguments?: string }
    if (!body.sessionId || !body.command) return c.json({ error: 'sessionId and command required' }, 400)
    await client.session.command({ path: { id: body.sessionId }, body: { command: body.command, arguments: body.arguments ?? '' } } as any)
    return c.json({ ok: true })
  })
}
