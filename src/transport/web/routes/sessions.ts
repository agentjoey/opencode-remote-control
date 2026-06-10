import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../../core/state.js'
import { fetchSessionSummaries, cleanupSubagentSessions } from '../session-summary.js'

export function registerSessions(app: Hono, client: OpencodeClient, state: SessionState) {
  app.get('/api/sessions', async (c) => {
    const summaries = await fetchSessionSummaries(client, state)
    return c.json(summaries)
  })

  // Destructive, user-triggered: remove all subagent child sessions.
  app.post('/api/sessions/cleanup-subagents', async (c) => {
    const deleted = await cleanupSubagentSessions(client)
    return c.json({ deleted })
  })

  // Destructive, user-triggered: delete a single session by id.
  app.post('/api/sessions/:id/delete', async (c) => {
    const id = c.req.param('id')
    try {
      await client.session.delete({ path: { id } })
      return c.json({ ok: true })
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 500)
    }
  })
}
