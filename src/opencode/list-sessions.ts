import type { OpencodeClient } from '@opencode-ai/sdk'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Resolve opencode's global sqlite db path (XDG-aware). */
function opencodeDbPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'opencode', 'opencode.db')
}

/**
 * Read the distinct working directories opencode has stored sessions in,
 * straight from its sqlite storage.
 *
 * Why we must: opencode's HTTP API only lists sessions by EXACT `directory`
 * match (`GET /session?directory=…`) and exposes no "list all" route. Sessions
 * started in ad-hoc folders (anything that isn't its own git project, e.g.
 * `~/AgentWorks`) all live under the synthetic "global" project whose worktree
 * is "/". Querying "/" matches zero sessions, so those directories are
 * otherwise undiscoverable — the only place that knows them is the db itself.
 *
 * Best-effort and cross-runtime: prefers Bun's `bun:sqlite` (opencode's own
 * runtime / the plugin hub) and falls back to Node's built-in `node:sqlite`
 * (the standalone host runs under Node ≥22.5). Returns [] only if neither sqlite
 * binding nor the db is available, so callers degrade to project-worktree listing.
 */
const DB_DIRS_SQL = 'SELECT DISTINCT directory FROM session WHERE directory IS NOT NULL'

export async function directoriesFromDb(): Promise<string[]> {
  const dbPath = opencodeDbPath()
  if (!existsSync(dbPath)) return []

  // 1) Bun's sqlite (db.query(sql).all(); { readonly }).
  try {
    const specifier = 'bun:sqlite' // variable specifier hides this Bun builtin from tsc/node
    const { Database } = (await import(specifier)) as any
    const db = new Database(dbPath, { readonly: true })
    try {
      const rows = db.query(DB_DIRS_SQL).all() as Array<{ directory: string }>
      return rows.map((r) => r.directory).filter(Boolean)
    } finally {
      db.close()
    }
  } catch {
    /* not running under Bun — fall through to node:sqlite */
  }

  // 2) Node's built-in sqlite (db.prepare(sql).all(); { readOnly }).
  try {
    const specifier = 'node:sqlite'
    const { DatabaseSync } = (await import(specifier)) as any
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const rows = db.prepare(DB_DIRS_SQL).all() as Array<{ directory: string }>
      return rows.map((r) => r.directory).filter(Boolean)
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

export interface ListAllOptions {
  /**
   * Extra directories to query beyond project worktrees. Defaults to reading
   * opencode's db. Injectable for tests (the default needs Bun's sqlite).
   */
  extraDirectories?: () => Promise<string[]>
}

/**
 * List sessions across ALL opencode projects/directories.
 *
 * opencode scopes sessions per directory: `client.session.list()` returns only
 * the sessions for the server's current directory, and `session.list({
 * directory })` matches that directory EXACTLY. A session started in another
 * folder's TUI is therefore invisible unless we query its exact directory. We
 * collect directories from two sources and aggregate:
 *   1. project worktrees (covers real git projects)
 *   2. the db's distinct session directories (covers the "global" project's
 *      ad-hoc dirs, which the API can't enumerate)
 * The global project's worktree "/" is skipped — it matches nothing.
 *
 * Best-effort: if project enumeration fails we still return the default listing.
 */
export async function listAllSessions(
  client: OpencodeClient,
  opts: ListAllOptions = {},
): Promise<any[]> {
  const extraDirectories = opts.extraDirectories ?? directoriesFromDb
  const byId = new Map<string, any>()
  const add = (arr: any[] | undefined) => {
    for (const s of arr ?? []) if (s?.id) byId.set(s.id, s)
  }

  // Always include the default (current-directory) listing.
  try {
    add((await client.session.list()).data as any[])
  } catch {
    /* ignore */
  }

  // Build the set of directories to query.
  const dirs = new Set<string>()
  try {
    const projects = ((await client.project.list()).data ?? []) as Array<{ worktree?: string }>
    for (const p of projects) if (p.worktree && p.worktree !== '/') dirs.add(p.worktree)
  } catch {
    /* ignore — fall back to whatever the default listing returned */
  }
  try {
    for (const d of await extraDirectories()) if (d && d !== '/') dirs.add(d)
  } catch {
    /* ignore — db discovery is best-effort */
  }

  if (dirs.size > 0) {
    const lists = await Promise.all(
      [...dirs].map((directory) =>
        client.session
          .list({ query: { directory } })
          .then((r) => r.data as any[])
          .catch(() => [] as any[]),
      ),
    )
    for (const l of lists) add(l)
  }

  return [...byId.values()]
}
