import { describe, it, expect } from 'vitest'
import { listAllSessions } from '../../src/opencode/list-sessions'
import type { OpencodeClient } from '@opencode-ai/sdk'

/** Client whose session.list matches `directory` EXACTLY, like real opencode. */
function makeClient(opts: {
  defaultDir?: any[]
  byDir?: Record<string, any[]>
  worktrees?: string[]
  projectListThrows?: boolean
}) {
  const byDir = opts.byDir ?? {}
  return {
    session: {
      list: async (o?: any) => {
        const dir = o?.query?.directory
        return { data: dir === undefined ? (opts.defaultDir ?? []) : (byDir[dir] ?? []) }
      },
    },
    project: {
      list: async () => {
        if (opts.projectListThrows) throw new Error('no projects')
        return { data: (opts.worktrees ?? []).map((worktree) => ({ worktree })) }
      },
    },
  } as unknown as OpencodeClient
}

// Tests pass extraDirectories explicitly so the Bun-only db reader isn't hit under node.
const noDb = { extraDirectories: async () => [] as string[] }

describe('listAllSessions', () => {
  it('aggregates across project worktrees, de-duplicated by id', async () => {
    const client = makeClient({
      defaultDir: [{ id: 's1' }],
      worktrees: ['/Users/x/repo-a', '/Users/x/repo-b'],
      byDir: {
        '/Users/x/repo-a': [{ id: 's1' }, { id: 'sA' }], // dup s1 across dirs
        '/Users/x/repo-b': [{ id: 'sB' }],
      },
    })
    const out = await listAllSessions(client, noDb)
    expect(out.map((s) => s.id).sort()).toEqual(['s1', 'sA', 'sB'])
  })

  it('discovers global ad-hoc sessions via db directories the project list omits', async () => {
    // Reproduces the DevHub bug: the global project's worktree is "/", which
    // opencode matches to ZERO sessions. The real directory only comes from the db.
    const client = makeClient({
      defaultDir: [],
      worktrees: ['/'], // only the synthetic global project
      byDir: {
        '/': [], // "/" matches nothing in opencode
        '/Users/x/AgentWorks': [{ id: 'devhub', title: 'DevHub' }],
      },
    })

    // Without db directories, DevHub is invisible (the original bug).
    const broken = await listAllSessions(client, noDb)
    expect(broken.map((s) => s.id)).not.toContain('devhub')

    // With the db supplying the real directory, DevHub appears.
    const fixed = await listAllSessions(client, {
      extraDirectories: async () => ['/Users/x/AgentWorks'],
    })
    expect(fixed.map((s) => s.id)).toContain('devhub')
  })

  it('never queries the global "/" worktree (it matches nothing, wastes a call)', async () => {
    const queried: string[] = []
    const client = {
      session: {
        list: async (o?: any) => {
          if (o?.query?.directory) queried.push(o.query.directory)
          return { data: [] }
        },
      },
      project: { list: async () => ({ data: [{ worktree: '/' }, { worktree: '/Users/x/repo' }] }) },
    } as unknown as OpencodeClient
    await listAllSessions(client, noDb)
    expect(queried).toContain('/Users/x/repo')
    expect(queried).not.toContain('/')
  })

  it('falls back to the default listing when project enumeration fails', async () => {
    const client = makeClient({ defaultDir: [{ id: 's1' }], projectListThrows: true })
    const out = await listAllSessions(client, noDb)
    expect(out.map((s) => s.id)).toEqual(['s1'])
  })
})
