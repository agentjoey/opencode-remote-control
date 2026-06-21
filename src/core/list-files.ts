/**
 * List files under a directory for the composer's @-mention picker. Walks the tree
 * (skipping heavy/noise dirs), returns workspace-relative paths, optionally filtered
 * by a substring query. Bounded so a huge repo can't hang or flood the response.
 */
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Directory names never worth mentioning — skipped wholesale during the walk. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage',
  '.svelte-kit', '.next', '.nuxt', '.cache', '.turbo', 'vendor', '__pycache__',
])

export interface ListFilesOptions {
  /** Max files to scan before stopping the walk (perf guard). */
  scanCap?: number
  /** Max files to return. */
  limit?: number
}

export async function listFiles(root: string, query = '', opts: ListFilesOptions = {}): Promise<string[]> {
  const scanCap = opts.scanCap ?? 5000
  const limit = opts.limit ?? 50
  const q = query.trim().toLowerCase()
  const out: string[] = []
  let scanned = 0

  async function walk(dir: string): Promise<void> {
    if (scanned >= scanCap) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (scanned >= scanCap) return
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        await walk(join(dir, e.name))
      } else {
        scanned++
        const rel = relative(root, join(dir, e.name)).split(sep).join('/')
        if (!q || rel.toLowerCase().includes(q)) out.push(rel)
      }
    }
  }

  await walk(root)
  // Prefer shorter paths + a leading-segment match (more relevant) when filtering.
  out.sort((a, b) => a.length - b.length)
  return out.slice(0, limit)
}
