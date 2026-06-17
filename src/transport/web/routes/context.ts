import type { Hono } from 'hono'
import type { AgentBackend } from '../../../core/agent/backend.js'
import type { SessionState } from '../../../core/state.js'

export function registerContext(app: Hono, backend: AgentBackend, state: SessionState) {
  app.get('/api/session/:id/context', async (c) => {
    const id = c.req.param('id')
    const ctx = await backend.getContext(id)
    return c.json({
      sessionId: id,
      agent: ctx.agent,
      model: ctx.model,
      tokens: ctx.tokens,
      cost: ctx.cost ?? state.getSessionCost(id),
      directory: ctx.directory,
      nextAgent: state.getNextAgent(),
      nextModel: state.getNextModel(),
    })
  })
}
