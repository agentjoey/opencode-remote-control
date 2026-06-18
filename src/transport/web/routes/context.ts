import type { Hono } from 'hono'
import type { BackendRegistry } from '../../../core/agent/registry.js'
import type { SessionState } from '../../../core/state.js'

export function registerContext(app: Hono, reg: BackendRegistry, state: SessionState) {
  app.get('/api/session/:id/context', async (c) => {
    const id = c.req.param('id')
    const ctx = await reg.forSession(id).getContext(id)
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
