import { describe, it, expect } from 'vitest'
import { buildWorkspaces } from '../../src/opencode/workspaces'

describe('buildWorkspaces', () => {
  it('merges project worktrees + db dirs, dedupes, names by basename, drops "/"', () => {
    const ws = buildWorkspaces({
      worktrees: ['/Users/x/repo-a', '/'],
      dbDirs: ['/Users/x/repo-a', '/Users/x/AgentWorks'],
      sessions: [
        { id: 's1', directory: '/Users/x/repo-a', time: { updated: 200 } },
        { id: 's2', directory: '/Users/x/AgentWorks', time: { updated: 500 } },
        { id: 's3', directory: '/Users/x/repo-a', time: { updated: 100 } },
      ],
    })
    const byDir = Object.fromEntries(ws.map((w) => [w.directory, w]))
    expect(Object.keys(byDir).sort()).toEqual(['/Users/x/AgentWorks', '/Users/x/repo-a'])
    expect(byDir['/Users/x/repo-a'].name).toBe('repo-a')
    expect(byDir['/Users/x/repo-a'].sessionCount).toBe(2)
    expect(byDir['/Users/x/AgentWorks'].sessionCount).toBe(1)
    expect(ws[0].directory).toBe('/Users/x/AgentWorks') // sorted by recent activity (500 > 200)
    expect(byDir['/Users/x/repo-a'].lastActiveAt).toBe(200)
  })

  it('ignores the "/" worktree even if present in both sources', () => {
    const ws = buildWorkspaces({ worktrees: ['/'], dbDirs: ['/'], sessions: [] })
    expect(ws).toEqual([])
  })
})
