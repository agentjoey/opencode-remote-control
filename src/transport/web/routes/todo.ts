import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'

export function registerTodo(app: Hono, client: OpencodeClient) {
  app.get('/api/session/:id/todo', async (c) => {
    const id = c.req.param('id')
    const res = await (client.session as any).todo({ path: { id } } as any)
    return c.json(res.data ?? [])
  })
}
