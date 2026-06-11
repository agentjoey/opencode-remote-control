import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../core/state.js'
import { listAllSessions } from '../../opencode/list-sessions.js'

export interface SessionSummary {
  id: string
  title?: string
  agent?: string
  model?: string
  cost?: number
  lastActiveAt: number
  unread: boolean
  /** Absolute working directory of the session (for showing the repo/project). */
  directory?: string
  /** Lines added across the session's diff, when known. */
  additions?: number
  /** Lines deleted across the session's diff, when known. */
  deletions?: number
}

// Sidebar hygiene rules. opencode `time` fields are epoch milliseconds.
const STALE_MS = 14 * 24 * 60 * 60 * 1000 // hide sessions idle longer than this
const EMPTY_GRACE_MS = 60 * 60 * 1000     // keep a brand-new empty session visible this long

/** A session that never produced any content (no title, never updated past creation). */
function isEmptySession(s: any): boolean {
  const created = s.time?.created ?? 0
  const updated = s.time?.updated ?? created
  return !s.title && updated === created
}

export async function fetchSessionSummaries(
  client: OpencodeClient,
  state: SessionState,
): Promise<SessionSummary[]> {
  const all = await listAllSessions(client)
  const now = Date.now()

  // subagent child sessions (task tool) are never shown in the rail.
  const roots = all.filter((s) => !s.parentID)

  const visible: any[] = []
  for (const s of roots) {
    const created = s.time?.created ?? 0
    const updated = s.time?.updated ?? created

    if (isEmptySession(s)) {
      // Hide empty sessions older than the grace window (NON-destructively — a
      // GET listing must never have side effects, and auto-deleting here risked
      // wrong calls against cross-project sessions). Freshly-created ones stay
      // visible during the grace window. To actually purge them, use the manual
      // cleanup endpoint.
      if (now - created > EMPTY_GRACE_MS) continue
      visible.push(s)
      continue
    }

    // Hide (non-destructively) sessions with no activity for N days.
    if (now - updated > STALE_MS) continue
    visible.push(s)
  }

  visible.sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
  return visible.map((s) => ({
    id: s.id,
    title: s.title ?? '',
    agent: typeof s.agent === 'string' ? s.agent : s.agent?.name,
    model: typeof s.model === 'string' ? s.model : s.model?.id,
    cost: state.getSessionCost(s.id),
    lastActiveAt: s.time?.updated ?? s.time?.created ?? 0,
    unread: false,
    directory: typeof s.directory === 'string' ? s.directory : undefined,
    additions: s.summary?.additions,
    deletions: s.summary?.deletions,
  }))
}

/**
 * Delete all subagent child sessions (those with a parentID). Destructive and
 * user-triggered only — returns the number deleted.
 */
export async function cleanupSubagentSessions(client: OpencodeClient): Promise<number> {
  const all = await listAllSessions(client)
  const children = all.filter((s) => !!s.parentID)
  let deleted = 0
  for (const s of children) {
    try {
      await client.session.delete({ path: { id: s.id } })
      deleted++
    } catch {
      /* skip ones that fail; report how many succeeded */
    }
  }
  return deleted
}
