import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../../core/state.js'

export function registerAbort(app: Hono, client: OpencodeClient, state: SessionState) {
  app.post('/api/abort', async (c) => {
    const body = await c.req.json() as { sessionId: string }
    // 1) Stop our local stream processing for this session.
    state.getActiveAbort(body.sessionId)?.abort()
    // 2) Tell opencode to actually stop generating. submitPrompt uses
    //    promptAsync (detached server-side generation), so the local
    //    AbortController alone can't halt it — without this, stop does nothing.
    try {
      await client.session.abort({ path: { id: body.sessionId } })
    } catch {
      /* best-effort; local abort already fired */
    }
    return c.json({ ok: true })
  })
}
