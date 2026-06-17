import type { Hono } from 'hono'
import type { Workspace } from '../../../opencode/workspaces.js'

export function registerWorkspaces(app: Hono, listWorkspaces?: () => Promise<Workspace[]>) {
  app.get('/api/workspaces', async (c) => {
    if (!listWorkspaces) return c.json([])
    const ws = await listWorkspaces()
    return c.json(ws)
  })
}
