import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../../core/state.js'
import { fetchSessionSummaries } from '../session-summary.js'

export function registerSessions(app: Hono, client: OpencodeClient, state: SessionState) {
  app.get('/api/sessions', async (c) => {
    const summaries = await fetchSessionSummaries(client, state)
    return c.json(summaries)
  })
}
