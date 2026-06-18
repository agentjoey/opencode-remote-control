import type { Hono } from 'hono'
import type { PermissionDecision } from '../../../core/agent/backend.js'
import type { BackendRegistry } from '../../../core/agent/registry.js'

export function registerApproval(app: Hono, reg: BackendRegistry) {
  app.post('/api/approval', async (c) => {
    const body = await c.req.json() as { sessionId: string; requestId: string; decision: PermissionDecision }
    await reg.forSession(body.sessionId).resolvePermission(body.sessionId, body.requestId, body.decision)
    return c.json({ ok: true })
  })
}
