import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../core/state.js'

export interface SessionSummary {
  id: string
  title?: string
  agent?: string
  model?: string
  cost?: number
  lastActiveAt: number
  unread: boolean
}

export async function fetchSessionSummaries(
  client: OpencodeClient,
  state: SessionState,
): Promise<SessionSummary[]> {
  const res = await client.session.list()
  const all = (res.data ?? []) as Array<any>
  const touched = all.filter((s) => state.getSessionCost(s.id) !== undefined)
  const visible = touched.length > 0 ? touched : all.slice(0, 10)
  const sorted = visible.sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
  return sorted.map((s) => ({
    id: s.id,
    title: s.title ?? '',
    agent: typeof s.agent === 'string' ? s.agent : s.agent?.name,
    model: typeof s.model === 'string' ? s.model : s.model?.id,
    cost: state.getSessionCost(s.id),
    lastActiveAt: s.time?.updated ?? s.time?.created ?? 0,
    unread: false,
  }))
}
