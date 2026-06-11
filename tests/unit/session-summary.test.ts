import { describe, it, expect } from 'vitest'
import { fetchSessionSummaries, cleanupSubagentSessions } from '../../src/transport/web/session-summary'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../src/core/state'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

function makeClient(sessions: any[], messages: Record<string, unknown[]> = {}) {
  const deleted: string[] = []
  const client = {
    session: {
      list: async () => ({ data: sessions }),
      messages: async ({ path }: any) => ({ data: messages[path.id] ?? [] }),
      delete: async ({ path }: any) => { deleted.push(path.id); return {} },
    },
    project: { list: async () => ({ data: [] }) },
  } as unknown as OpencodeClient
  return { client, deleted }
}

const state = { getSessionCost: () => 0 } as unknown as SessionState
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('fetchSessionSummaries', () => {
  it('hides subagent children, stale, and old-empty sessions; keeps active + fresh-empty', async () => {
    const now = Date.now()
    const sessions = [
      { id: 'active', title: 'Hello', time: { created: now - 1000, updated: now - 1000 } },
      { id: 'child', parentID: 'active', title: 'sub', time: { created: now - 1000, updated: now - 1000 } },
      { id: 'stale', title: 'Old', time: { created: now - 20 * DAY, updated: now - 20 * DAY } },
      { id: 'empty-old', title: '', time: { created: now - 2 * HOUR, updated: now - 2 * HOUR } },
      { id: 'empty-new', title: '', time: { created: now - 1000, updated: now - 1000 } },
    ]
    const { client } = makeClient(sessions)
    const out = await fetchSessionSummaries(client, state)
    const ids = out.map((s) => s.id)
    expect(ids).toContain('active')
    expect(ids).toContain('empty-new')
    expect(ids).not.toContain('child')
    expect(ids).not.toContain('stale')
    expect(ids).not.toContain('empty-old')
  })

  it('hides old empty sessions but never deletes them (a GET listing has no side effects)', async () => {
    const now = Date.now()
    const sessions = [
      { id: 'empty-old', title: '', time: { created: now - 2 * HOUR, updated: now - 2 * HOUR } },
    ]
    const { client, deleted } = makeClient(sessions)
    const out = await fetchSessionSummaries(client, state)
    await flush()
    expect(out.map((s) => s.id)).not.toContain('empty-old') // hidden from the list
    expect(deleted).toHaveLength(0)                          // but NOT deleted
  })
})

describe('cleanupSubagentSessions', () => {
  it('deletes every session with a parentID and returns the count', async () => {
    const sessions = [
      { id: 'root', time: { created: 1, updated: 1 } },
      { id: 'c1', parentID: 'root', time: { created: 1, updated: 1 } },
      { id: 'c2', parentID: 'root', time: { created: 1, updated: 1 } },
    ]
    const { client, deleted } = makeClient(sessions)
    const n = await cleanupSubagentSessions(client)
    expect(n).toBe(2)
    expect(deleted.sort()).toEqual(['c1', 'c2'])
  })
})
