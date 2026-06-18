import { describe, it, expect } from 'vitest'
import { fetchSessionSummaries, cleanupSubagentSessions } from '../../src/transport/web/session-summary'
import type { AgentBackend } from '../../src/core/agent/backend'
import { singleBackendRegistry } from '../../src/core/agent/registry'
import type { SessionState } from '../../src/core/state'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

function makeBackend(summaries: any[], sessions: any[] = []) {
  const deleted: string[] = []
  const backend = {
    id: 'opencode',
    capabilities: { liveMirror: false, tuiSelect: false },
    listSessionSummaries: async () => summaries,
    listSessions: async () => sessions,
    deleteSession: async (id: string) => { deleted.push(id) },
  } as unknown as AgentBackend
  return { backend, deleted }
}

const state = { getSessionCost: () => 0 } as unknown as SessionState
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('fetchSessionSummaries', () => {
  it('returns summaries with cost merged from state', async () => {
    const now = Date.now()
    const summaries = [
      { id: 'active', title: 'Hello', lastActiveAt: now - 1000, unread: false },
      { id: 'other', title: 'Other', lastActiveAt: now - 2000, unread: false },
    ]
    const { backend } = makeBackend(summaries)
    const out = await fetchSessionSummaries(singleBackendRegistry(backend), state)
    const ids = out.map((s) => s.id)
    expect(ids).toContain('active')
    expect(ids).toContain('other')
  })

  it('cost from state overrides summary cost', async () => {
    const costState = { getSessionCost: (id: string) => id === 'x' ? 0.5 : undefined } as unknown as SessionState
    const summaries = [{ id: 'x', title: 'X', lastActiveAt: 1, unread: false, cost: 0.1 }]
    const { backend } = makeBackend(summaries)
    const out = await fetchSessionSummaries(singleBackendRegistry(backend), costState)
    expect(out[0].cost).toBe(0.5)
  })
})

describe('cleanupSubagentSessions', () => {
  it('deletes every session with a parentID and returns the count', async () => {
    const sessions = [
      { id: 'root' },
      { id: 'c1', parentID: 'root' },
      { id: 'c2', parentID: 'root' },
    ]
    const { backend, deleted } = makeBackend([], sessions)
    const n = await cleanupSubagentSessions(singleBackendRegistry(backend))
    expect(n).toBe(2)
    expect(deleted.sort()).toEqual(['c1', 'c2'])
  })
})
