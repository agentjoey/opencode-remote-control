import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { reconstructHistory } from '../../../core/history.js'

export function registerSession(app: Hono, client: OpencodeClient) {
  app.get('/api/session/:id', async (c) => {
    const id = c.req.param('id')
    const raw = c.req.query('limit')
    const limit = raw ? Math.max(0, Math.min(500, parseInt(raw, 10) || 0)) : undefined
    const cards = await reconstructHistory(client, id, limit)
    return c.json(cards)
  })
}
