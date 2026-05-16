import type { Hono } from 'hono'
import type { SessionState } from '../../../core/state.js'

export function registerAbort(app: Hono, state: SessionState) {
  app.post('/api/abort', async (c) => {
    const body = await c.req.json() as { sessionId: string }
    const ac = state.getActiveAbort(body.sessionId)
    ac?.abort()
    return c.json({ ok: true })
  })
}
