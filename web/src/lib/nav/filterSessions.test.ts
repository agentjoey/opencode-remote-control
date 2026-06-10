// src/lib/nav/filterSessions.test.ts
import { describe, it, expect } from 'vitest'
import { filterSessions } from './filterSessions.js'
import type { SessionSummary } from '../api/types.js'

const S = (id: string, title: string, agent?: string): SessionSummary =>
  ({ id, title, agent, lastActiveAt: 0, unread: false } as any)
const list = [S('ses_a', 'Add F1 streaming', 'build'), S('ses_b', 'Refactor auth', 'plan'), S('ses_c', 'Fix CI', 'build')]

describe('filterSessions', () => {
  it('returns all when query is empty', () => {
    expect(filterSessions(list, '').length).toBe(3)
  })
  it('matches case-insensitively on title and agent', () => {
    expect(filterSessions(list, 'auth').map(s => s.id)).toEqual(['ses_b'])
    expect(filterSessions(list, 'BUILD').map(s => s.id)).toEqual(['ses_a', 'ses_c'])
  })
  it('matches on the short id', () => {
    expect(filterSessions(list, 'ses_c').map(s => s.id)).toEqual(['ses_c'])
  })
})
