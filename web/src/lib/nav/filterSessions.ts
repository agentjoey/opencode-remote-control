// src/lib/nav/filterSessions.ts
import type { SessionSummary } from '../api/types.js'

export function filterSessions(list: SessionSummary[], query: string): SessionSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((s) =>
    (s.title ?? '').toLowerCase().includes(q) ||
    (s.agent ?? '').toLowerCase().includes(q) ||
    s.id.toLowerCase().includes(q))
}
