import type { Hono } from 'hono'
import { fetchOpencodeConfig } from '../opencode-config.js'

export interface McpServer { name: string; type?: string; status: 'configured' | 'disabled' }

export function registerMcp(app: Hono, baseUrl: string) {
  // opencode's SDK exposes no MCP API, so read the raw /config 'mcp' section.
  // This reflects *configured* servers; live connection status is not available.
  app.get('/api/mcp', async (c) => {
    const cfg = await fetchOpencodeConfig(baseUrl, '/config')
    const mcp = (cfg?.mcp ?? {}) as Record<string, { type?: string; enabled?: boolean }>
    const out: McpServer[] = Object.entries(mcp).map(([name, v]) => ({
      name,
      type: v?.type,
      status: v?.enabled === false ? 'disabled' : 'configured',
    }))
    return c.json(out)
  })
}
