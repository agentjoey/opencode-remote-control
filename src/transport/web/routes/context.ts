import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../../core/state.js'

export function registerContext(app: Hono, client: OpencodeClient, state: SessionState) {
  app.get('/api/session/:id/context', async (c) => {
    const id = c.req.param('id')
    const res = await client.session.get({ path: { id } })
    const s = (res.data ?? {}) as any
    return c.json({
      sessionId: id,
      agent: s.agent?.name,
      model: typeof s.model === 'string' ? s.model : undefined,
      tokens: s.tokens,
      cost: typeof s.cost === 'number' ? s.cost : state.getSessionCost(id),
      nextAgent: state.getNextAgent(),
      nextModel: state.getNextModel(),
    })
  })
}
