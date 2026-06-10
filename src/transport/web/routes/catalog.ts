import type { Hono } from 'hono'
import { fetchOpencodeConfig } from '../opencode-config.js'

export function registerCatalog(app: Hono, baseUrl: string) {
  app.get('/api/agents', async (c) => {
    const cfg = await fetchOpencodeConfig(baseUrl, '/config')
    const agents = (cfg?.agent ?? {}) as Record<string, { model?: string; description?: string }>
    return c.json(
      Object.entries(agents)
        .filter(([, v]) => typeof v.model === 'string')
        .map(([name, v]) => ({ name, model: v.model as string, description: v.description ?? '' })),
    )
  })

  app.get('/api/models', async (c) => {
    const cfg = await fetchOpencodeConfig(baseUrl, '/config/providers')
    const providers = (cfg?.providers ?? []) as Array<{ id: string; name: string; models: Record<string, { name?: string }> }>
    return c.json(
      providers.map((p) => ({
        id: p.id,
        name: p.name,
        models: Object.entries(p.models ?? {}).map(([id, m]) => ({ id, name: m?.name ?? id })),
      })),
    )
  })
}
