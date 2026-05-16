import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'

export function registerDiff(app: Hono, client: OpencodeClient) {
  app.get('/api/session/:id/diff', async (c) => {
    const id = c.req.param('id')
    const res = await (client.session as any).diff({ path: { id } } as any)
    return c.json(res.data ?? [])
  })
}
