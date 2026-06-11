import type { SessionSummary } from '../api/types.js'

/** Filter the session list to the selected workspace directory (null = all). */
export function filterByWorkspace(sessions: SessionSummary[], workspace: string | null): SessionSummary[] {
  if (!workspace) return sessions
  return sessions.filter((s) => s.directory === workspace)
}
