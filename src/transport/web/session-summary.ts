import type { AgentBackend, SessionSummary } from '../../core/agent/backend.js'
import type { SessionState } from '../../core/state.js'

export type { SessionSummary }

export async function fetchSessionSummaries(
  backend: AgentBackend,
  state: SessionState,
): Promise<SessionSummary[]> {
  const summaries = await backend.listSessionSummaries()
  return summaries.map((s) => ({ ...s, cost: state.getSessionCost(s.id) ?? s.cost }))
}

export async function cleanupSubagentSessions(backend: AgentBackend): Promise<number> {
  const all = await backend.listSessions()
  const children = all.filter((s) => !!s.parentID)
  let deleted = 0
  for (const s of children) {
    try {
      await backend.deleteSession(s.id)
      deleted++
    } catch {
      /* skip ones that fail; report how many succeeded */
    }
  }
  return deleted
}
