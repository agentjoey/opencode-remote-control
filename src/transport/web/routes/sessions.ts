import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../../core/state.js'

export function registerSessions(app: Hono, client: OpencodeClient, state: SessionState) {
  app.get('/api/sessions', async (c) => {
    const res = await client.session.list()
    const all = (res.data ?? []) as Array<any>
    const touched = all.filter((s) => state.getSessionCost(s.id) !== undefined)
    const visible = touched.length > 0 ? touched : all.slice(0, 10)
    const sorted = visible.sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
    const summaries = sorted.map((s) => ({
      id: s.id,
      title: s.title ?? '',
      agent: s.agent?.name,
      model: typeof s.model === 'string' ? s.model : undefined,
      cost: state.getSessionCost(s.id),
      lastActiveAt: s.time?.updated ?? s.time?.created ?? 0,
      unread: false,
    }))
    return c.json(summaries)
  })
}
