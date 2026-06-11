import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'

export function registerRename(app: Hono, client: OpencodeClient) {
  app.post('/api/sessions/:id/rename', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({})) as { title?: string }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return c.json({ error: 'title required' }, 400)
    await client.session.update({ path: { id }, body: { title } } as any)
    return c.json({ ok: true })
  })
}
