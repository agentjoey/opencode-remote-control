/**
 * Build a normalized DiffEntry from two file versions, shared by every backend's
 * getDiff. Uses jsdiff's line diff; trims long unchanged runs to ~3 lines of
 * context around changes, and guards against pathologically large diffs.
 */
import { diffLines } from 'diff'
import type { DiffEntry, DiffLine } from './backend.js'

const CTX = 3 // context lines kept around each change
const MAX_CHANGED = 2000 // beyond this, return counts only (no full lines)

/** Split a jsdiff chunk value into lines, dropping the trailing empty element. */
function toLines(value: string): string[] {
  const arr = value.split('\n')
  if (arr.length > 0 && arr[arr.length - 1] === '') arr.pop()
  return arr
}

export function buildDiffEntry(path: string, oldText: string, newText: string): DiffEntry {
  const parts = diffLines(oldText ?? '', newText ?? '')

  let additions = 0
  let deletions = 0
  for (const p of parts) {
    if (p.added) additions += toLines(p.value).length
    else if (p.removed) deletions += toLines(p.value).length
  }

  if (additions + deletions === 0) return { path, additions: 0, deletions: 0, lines: [] }
  if (additions + deletions > MAX_CHANGED) {
    return { path, additions, deletions, lines: [{ kind: 'ctx', text: `… ${additions + deletions} changed lines (truncated) …` }] }
  }

  const lines: DiffLine[] = []
  parts.forEach((p, i) => {
    const ls = toLines(p.value)
    if (p.added) { for (const text of ls) lines.push({ kind: 'add', text }) }
    else if (p.removed) { for (const text of ls) lines.push({ kind: 'del', text }) }
    else {
      // Unchanged context: keep only ~CTX lines adjacent to changes; collapse the
      // middle of long runs so the payload stays small.
      const isFirst = i === 0
      const isLast = i === parts.length - 1
      if (ls.length <= CTX * 2) { for (const text of ls) lines.push({ kind: 'ctx', text }) }
      else if (isFirst) { for (const text of ls.slice(-CTX)) lines.push({ kind: 'ctx', text }) }
      else if (isLast) { for (const text of ls.slice(0, CTX)) lines.push({ kind: 'ctx', text }) }
      else {
        for (const text of ls.slice(0, CTX)) lines.push({ kind: 'ctx', text })
        lines.push({ kind: 'ctx', text: '…' })
        for (const text of ls.slice(-CTX)) lines.push({ kind: 'ctx', text })
      }
    }
  })
  return { path, additions, deletions, lines }
}
