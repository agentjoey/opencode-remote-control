import type { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'

export function registerCatalog(app: Hono, client: OpencodeClient) {
  app.get('/api/agents', async (c) => {
    let agents: Record<string, { model?: string; description?: string }> = {}
    try { agents = (((await client.config.get()).data as any)?.agent ?? {}) } catch { /* empty */ }
    return c.json(
      Object.entries(agents)
        .filter(([, v]) => typeof v?.model === 'string')
        .map(([name, v]) => ({ name, model: v!.model as string, description: v?.description ?? '' })),
    )
  })

  app.get('/api/models', async (c) => {
    let providers: Array<{ id: string; name: string; models: Record<string, { name?: string }> }> = []
    try { providers = (((await client.config.providers()).data as any)?.providers ?? []) } catch { /* empty */ }
    return c.json(
      providers.map((p) => ({
        id: p.id,
        name: p.name,
        models: Object.entries(p.models ?? {}).map(([id, m]) => ({ id, name: m?.name ?? id })),
      })),
    )
  })
}
