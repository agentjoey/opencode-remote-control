import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'

export function registerCreateSession(app: Hono, client: OpencodeClient) {
  app.post('/api/session', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { directory?: string; title?: string }
    if (typeof body.directory !== 'string' || !body.directory.trim()) {
      return c.json({ error: 'directory required' }, 400)
    }
    // `as any`: the SDK's generated create() type omits the `directory` query
    // param, but opencode accepts it (creates the session in that directory).
    const res = await client.session.create({
      query: { directory: body.directory },
      body: body.title ? { title: body.title } : {},
    } as any)
    const id = (res.data as { id?: string } | undefined)?.id
    if (!id) return c.json({ error: 'create failed' }, 500)
    return c.json({ id })
  })
}
