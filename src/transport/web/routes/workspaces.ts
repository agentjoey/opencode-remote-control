import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { listWorkspaces } from '../../../opencode/workspaces.js'

export function registerWorkspaces(app: Hono, client: OpencodeClient) {
  app.get('/api/workspaces', async (c) => {
    const ws = await listWorkspaces(client)
    return c.json(ws)
  })
}
