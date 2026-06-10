import type { Hono } from 'hono'
import type { SessionState } from '../../../core/state.js'

export function registerOverrides(app: Hono, state: SessionState) {
  app.get('/api/overrides', (c) =>
    c.json({ agent: state.getNextAgent() ?? null, model: state.getNextModel() ?? null }))

  app.post('/api/overrides', async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      agent?: string | null
      model?: { providerID: string; modelID: string } | null
    }
    if ('agent' in body) state.setNextAgent(body.agent ?? undefined)
    if ('model' in body) state.setNextModel(body.model ?? undefined)
    return c.json({ ok: true })
  })
}
