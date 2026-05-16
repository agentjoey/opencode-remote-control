import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { reconstructHistory } from '../../../core/history.js'

export function registerSession(app: Hono, client: OpencodeClient) {
  app.get('/api/session/:id', async (c) => {
    const id = c.req.param('id')
    const cards = await reconstructHistory(client, id)
    return c.json(cards)
  })
}
