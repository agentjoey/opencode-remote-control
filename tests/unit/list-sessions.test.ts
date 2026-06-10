import { describe, it, expect } from 'vitest'
import { listAllSessions } from '../../src/opencode/list-sessions'
import type { OpencodeClient } from '@opencode-ai/sdk'

function makeClient(byDir: Record<string, any[]>, projectListThrows = false) {
  return {
    session: {
      list: async (opts?: any) => {
        const dir = opts?.query?.directory
        return { data: dir ? (byDir[dir] ?? []) : (byDir['__default__'] ?? []) }
      },
    },
    project: {
      list: async () => {
        if (projectListThrows) throw new Error('no projects')
        const worktrees = Object.keys(byDir).filter((k) => k !== '__default__')
        return { data: worktrees.map((worktree) => ({ worktree })) }
      },
    },
  } as unknown as OpencodeClient
}

describe('listAllSessions', () => {
  it('aggregates sessions across every project directory, de-duplicated by id', async () => {
    const client = makeClient({
      '__default__': [{ id: 's1' }],            // server's current dir
      '/': [{ id: 's1' }, { id: 'sGlobal' }],   // global project (dup s1 + extra)
      '/Users/x/repo-a': [{ id: 'sA' }],
    })
    const out = await listAllSessions(client)
    expect(out.map((s) => s.id).sort()).toEqual(['s1', 'sA', 'sGlobal'])
  })

  it('falls back to the default listing when project enumeration fails', async () => {
    const client = makeClient({ '__default__': [{ id: 's1' }] }, true)
    const out = await listAllSessions(client)
    expect(out.map((s) => s.id)).toEqual(['s1'])
  })
})
