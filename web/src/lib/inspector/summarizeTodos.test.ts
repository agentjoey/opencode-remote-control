import { describe, it, expect } from 'vitest'
import { summarizeTodos } from './summarizeTodos.js'

describe('summarizeTodos', () => {
  it('maps opencode statuses to done/running/pending and counts done', () => {
    const out = summarizeTodos([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ])
    expect(out.total).toBe(3)
    expect(out.done).toBe(1)
    expect(out.items).toEqual([
      { text: 'a', status: 'done' },
      { text: 'b', status: 'running' },
      { text: 'c', status: 'pending' },
    ])
  })
  it('tolerates missing fields and alternative keys', () => {
    const out = summarizeTodos([{ text: 'x', status: 'done' }, {}])
    expect(out.items[0]).toEqual({ text: 'x', status: 'done' })
    expect(out.items[1]).toEqual({ text: '', status: 'pending' })
  })
  it('handles empty / non-array input', () => {
    expect(summarizeTodos([])).toEqual({ total: 0, done: 0, items: [] })
    expect(summarizeTodos(undefined as any)).toEqual({ total: 0, done: 0, items: [] })
  })
})
