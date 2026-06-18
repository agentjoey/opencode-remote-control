import type { Hono } from 'hono'
import type { BackendRegistry } from '../../../core/agent/registry.js'
import type { SessionState } from '../../../core/state.js'

export function registerAbort(app: Hono, reg: BackendRegistry, state: SessionState) {
  app.post('/api/abort', async (c) => {
    const body = await c.req.json() as { sessionId: string }
    state.getActiveAbort(body.sessionId)?.abort()
    await reg.forSession(body.sessionId).abort(body.sessionId)
    return c.json({ ok: true })
  })
}
