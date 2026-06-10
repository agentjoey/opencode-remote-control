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
  // Prefer root sessions over subagent sessions, then sort by most recent
  const sorted = [...all].sort((a, b) => {
    const aIsChild = !!a.parentID
    const bIsChild = !!b.parentID
    if (aIsChild !== bIsChild) return aIsChild ? 1 : -1
    return (b.time?.created ?? 0) - (a.time?.created ?? 0)
  })
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
