import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'

export interface McpServer { name: string; type?: string; status: 'configured' | 'disabled' }

export function registerMcp(app: Hono, client: OpencodeClient) {
  // Read MCP servers from the in-process SDK config (the opencode HTTP server is
  // not separately reachable). Reflects *configured* servers; live connection
  // status is not exposed.
  app.get('/api/mcp', async (c) => {
    let mcp: Record<string, { type?: string; enabled?: boolean }> = {}
    try { mcp = (((await client.config.get()).data as any)?.mcp ?? {}) } catch { /* empty */ }
    const out: McpServer[] = Object.entries(mcp).map(([name, v]) => ({
      name,
      type: v?.type,
      status: v?.enabled === false ? 'disabled' : 'configured',
    }))
    return c.json(out)
  })
}
