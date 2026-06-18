import type { SessionSummary } from '../../core/agent/backend.js'
import type { BackendRegistry } from '../../core/agent/registry.js'
import type { SessionState } from '../../core/state.js'

export type { SessionSummary }

/**
 * Aggregate session summaries across every backend in the registry, tagging each
 * row with its owning `backendId` (and recording that ownership in the registry
 * so later per-session routing resolves correctly). Costs are filled from OCRC
 * state. A backend that fails to list is skipped, not fatal.
 */
export async function fetchSessionSummaries(
  registry: BackendRegistry,
  state: SessionState,
): Promise<SessionSummary[]> {
  const out: SessionSummary[] = []
  for (const { id, backend } of registry.all()) {
    let rows: SessionSummary[]
    try {
      rows = await backend.listSessionSummaries()
    } catch {
      continue
    }
    for (const s of rows) {
      registry.tag(s.id, id)
      out.push({ ...s, backendId: id, cost: state.getSessionCost(s.id) ?? s.cost })
    }
  }
  return out
}

export async function cleanupSubagentSessions(registry: BackendRegistry): Promise<number> {
  let deleted = 0
  for (const { backend } of registry.all()) {
    let children
    try {
      children = (await backend.listSessions()).filter((s) => !!s.parentID)
    } catch {
      continue
    }
    for (const s of children) {
      try {
        await backend.deleteSession(s.id)
        deleted++
      } catch {
        /* skip ones that fail; report how many succeeded */
      }
    }
  }
  return deleted
}
