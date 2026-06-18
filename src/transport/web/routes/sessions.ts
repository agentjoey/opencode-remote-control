import type { Hono } from 'hono'
import type { BackendRegistry } from '../../../core/agent/registry.js'
import type { SessionState } from '../../../core/state.js'
import { fetchSessionSummaries, cleanupSubagentSessions } from '../session-summary.js'

export function registerSessions(app: Hono, reg: BackendRegistry, state: SessionState) {
  app.get('/api/sessions', async (c) => {
    const summaries = await fetchSessionSummaries(reg, state)
    return c.json(summaries)
  })

  app.post('/api/sessions/cleanup-subagents', async (c) => {
    const deleted = await cleanupSubagentSessions(reg)
    return c.json({ deleted })
  })

  app.post('/api/sessions/:id/delete', async (c) => {
    const id = c.req.param('id')
    try {
      await reg.forSession(id).deleteSession(id)
      return c.json({ ok: true })
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 500)
    }
  })
}
