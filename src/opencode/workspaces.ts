import type { OpencodeClient } from '@opencode-ai/sdk'
import { basename } from 'node:path'
import { directoriesFromDb, listAllSessions } from './list-sessions.js'

export interface Workspace {
  directory: string
  name: string
  sessionCount: number
  lastActiveAt: number
}

interface BuildInput {
  worktrees: string[]
  dbDirs: string[]
  sessions: Array<{ id: string; directory?: string; time?: { updated?: number; created?: number } }>
}

/** Pure: merge directories (project worktrees + db + sessions), attach per-dir
 * session stats, name by basename, drop the synthetic "/" worktree, sort by
 * most recent activity (desc). */
export function buildWorkspaces(input: BuildInput): Workspace[] {
  const dirs = new Set<string>()
  for (const d of input.worktrees) if (d && d !== '/') dirs.add(d)
  for (const d of input.dbDirs) if (d && d !== '/') dirs.add(d)
  for (const s of input.sessions) if (s.directory && s.directory !== '/') dirs.add(s.directory)

  const out: Workspace[] = []
  for (const dir of dirs) {
    const sessions = input.sessions.filter((s) => s.directory === dir)
    const lastActiveAt = sessions.reduce(
      (max, s) => Math.max(max, s.time?.updated ?? s.time?.created ?? 0),
      0,
    )
    out.push({ directory: dir, name: basename(dir) || dir, sessionCount: sessions.length, lastActiveAt })
  }
  out.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  return out
}

/** Enumerate workspaces from the live opencode client. */
export async function listWorkspaces(client: OpencodeClient): Promise<Workspace[]> {
  let worktrees: string[] = []
  try {
    const projects = ((await client.project.list()).data ?? []) as Array<{ worktree?: string }>
    worktrees = projects.map((p) => p.worktree).filter((w): w is string => !!w)
  } catch {
    /* ignore */
  }
  const dbDirs = await directoriesFromDb().catch(() => [])
  const sessions = (await listAllSessions(client).catch(() => [])) as BuildInput['sessions']
  return buildWorkspaces({ worktrees, dbDirs, sessions })
}
