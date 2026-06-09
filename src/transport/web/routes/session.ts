import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { CardBus } from '../../../core/card-bus.js'
import { reconstructHistory } from '../../../core/history.js'

export function registerSession(app: Hono, client: OpencodeClient, cardBus: CardBus) {
  app.get('/api/session/:id', async (c) => {
    const id = c.req.param('id')
    const raw = c.req.query('limit')
    const limit = raw ? Math.max(0, Math.min(500, parseInt(raw, 10) || 0)) : undefined
    const cards = await reconstructHistory(client, id, limit)
    // lastSeq lets the client subscribe with sinceSeq so the WS replays only
    // cards published after this snapshot — closing the history↔live gap.
    return c.json({ cards, lastSeq: cardBus.currentSeq(id) })
  })
}
