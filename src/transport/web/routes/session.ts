import type { Hono } from 'hono'
import type { AgentBackend } from '../../../core/agent/backend.js'
import type { CardBus } from '../../../core/card-bus.js'

export function registerSession(app: Hono, backend: AgentBackend, cardBus: CardBus) {
  app.get('/api/session/:id', async (c) => {
    const id = c.req.param('id')
    const raw = c.req.query('limit')
    const limit = raw ? Math.max(0, Math.min(500, parseInt(raw, 10) || 0)) : undefined
    const cards = await backend.getHistory(id, limit)
    return c.json({ cards, lastSeq: cardBus.currentSeq(id) })
  })
}
