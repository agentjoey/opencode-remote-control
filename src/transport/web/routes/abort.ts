import type { Hono } from 'hono'
import type { AgentBackend } from '../../../core/agent/backend.js'
import type { SessionState } from '../../../core/state.js'

export function registerAbort(app: Hono, backend: AgentBackend, state: SessionState) {
  app.post('/api/abort', async (c) => {
    const body = await c.req.json() as { sessionId: string }
    state.getActiveAbort(body.sessionId)?.abort()
    await backend.abort(body.sessionId)
    return c.json({ ok: true })
  })
}
