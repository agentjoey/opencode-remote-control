import type { OpencodeClient } from '@opencode-ai/sdk'

/**
 * List sessions across ALL opencode projects/directories.
 *
 * opencode scopes sessions per project: `client.session.list()` returns only
 * the sessions for the server's current directory, so a session started in
 * another folder's TUI is invisible. We enumerate every known project and
 * aggregate their sessions. Ad-hoc directories that aren't their own git
 * project (e.g. ~/AgentWorks) fall under the built-in "global" project whose
 * worktree is "/", so iterating projects covers them too.
 *
 * Best-effort: if project enumeration fails we still return the default listing.
 */
export async function listAllSessions(client: OpencodeClient): Promise<any[]> {
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

  // Then pull each project's directory explicitly.
  try {
    const projects = ((await client.project.list()).data ?? []) as Array<{ worktree?: string }>
    const dirs = projects.map((p) => p.worktree).filter((w): w is string => !!w)
    const lists = await Promise.all(
      dirs.map((directory) =>
        client.session
          .list({ query: { directory } })
          .then((r) => r.data as any[])
          .catch(() => [] as any[]),
      ),
    )
    for (const l of lists) add(l)
  } catch {
    /* ignore — fall back to whatever the default listing returned */
  }

  return [...byId.values()]
}
