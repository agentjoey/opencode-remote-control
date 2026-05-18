import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'

export function registerApproval(app: Hono, client: OpencodeClient) {
  app.post('/api/approval', async (c) => {
    const body = await c.req.json() as { sessionId: string; requestId: string; decision: 'once' | 'always' | 'reject' }
    await (client.session as any).postSessionIdPermissionsPermissionId({
      path: { id: body.sessionId, permissionID: body.requestId },
      body: { response: body.decision },
    })
    return c.json({ ok: true })
  })
}
