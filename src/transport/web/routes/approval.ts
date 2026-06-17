import type { Hono } from 'hono'
import type { AgentBackend, PermissionDecision } from '../../../core/agent/backend.js'

export function registerApproval(app: Hono, backend: AgentBackend) {
  app.post('/api/approval', async (c) => {
    const body = await c.req.json() as { sessionId: string; requestId: string; decision: PermissionDecision }
    await backend.resolvePermission(body.sessionId, body.requestId, body.decision)
    return c.json({ ok: true })
  })
}
