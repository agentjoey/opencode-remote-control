import { describe, it, expect } from 'vitest'
import { buildDiffEntry } from '../../../src/core/agent/diff-util'

describe('buildDiffEntry', () => {
  it('no change → empty', () => {
    expect(buildDiffEntry('a.ts', 'same\nlines', 'same\nlines')).toEqual({ path: 'a.ts', additions: 0, deletions: 0, lines: [] })
  })

  it('pure addition (new file)', () => {
    const e = buildDiffEntry('a.ts', '', 'one\ntwo')
    expect(e).toMatchObject({ path: 'a.ts', additions: 2, deletions: 0 })
    expect(e.lines).toEqual([{ kind: 'add', text: 'one' }, { kind: 'add', text: 'two' }])
  })

  it('modification counts adds + dels and keeps surrounding context (≤CTX)', () => {
    const e = buildDiffEntry('a.ts', 'a\nOLD\nc', 'a\nNEW\nc')
    expect(e).toMatchObject({ additions: 1, deletions: 1 })
    expect(e.lines.some((l) => l.kind === 'del' && l.text === 'OLD')).toBe(true)
    expect(e.lines.some((l) => l.kind === 'add' && l.text === 'NEW')).toBe(true)
    expect(e.lines.some((l) => l.kind === 'ctx' && l.text === 'a')).toBe(true) // context preserved
  })

  it('collapses long unchanged runs to ~3 context lines around a change', () => {
    const old = Array.from({ length: 30 }, (_, i) => `L${i}`).join('\n') + '\nTAIL'
    const neu = Array.from({ length: 30 }, (_, i) => `L${i}`).join('\n') + '\nTAILX'
    const e = buildDiffEntry('a.ts', old, neu)
    // a 30-line unchanged prefix must be trimmed, not emitted whole
    expect(e.lines.filter((l) => l.kind === 'ctx').length).toBeLessThan(10)
    expect(e.additions).toBe(1)
    expect(e.deletions).toBe(1)
  })

  it('truncation guard: > 2000 changed lines returns counts only', () => {
    const big = Array.from({ length: 2500 }, (_, i) => `x${i}`).join('\n')
    const e = buildDiffEntry('a.ts', '', big)
    expect(e.additions).toBe(2500)
    expect(e.lines).toHaveLength(1)
    expect(e.lines[0].kind).toBe('ctx')
    expect(e.lines[0].text).toContain('truncated')
  })
})
