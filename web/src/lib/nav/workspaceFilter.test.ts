import { describe, it, expect } from 'vitest'
import { filterByWorkspace } from './workspaceFilter'

const s = (id: string, directory: string) => ({ id, directory } as any)

describe('filterByWorkspace', () => {
  it('returns all sessions when no workspace selected', () => {
    expect(filterByWorkspace([s('a', '/x'), s('b', '/y')], null)).toHaveLength(2)
  })
  it('returns only sessions whose directory matches the selected workspace', () => {
    expect(filterByWorkspace([s('a', '/x'), s('b', '/y'), s('c', '/x')], '/x').map((x) => x.id)).toEqual(['a', 'c'])
  })
})
