import type { Hono } from 'hono'
import type { BackendRegistry } from '../../../core/agent/registry.js'

/**
 * Session controls — read the switchable mode + model for a session, and switch
 * them. Backed by the optional getControls/setMode/setModel (present only when the
 * backend's `sessionControls` capability is true; ACP/kimi). Missing → 404/empty.
 */
export function registerControls(app: Hono, reg: BackendRegistry) {
  app.get('/api/session/:id/controls', async (c) => {
    const id = c.req.param('id')
    return c.json((await reg.forSession(id).getControls?.(id)) ?? {})
  })

  app.post('/api/session/:id/mode', async (c) => {
    const id = c.req.param('id')
    const { modeId } = await c.req.json<{ modeId?: string }>().catch(() => ({ modeId: undefined }))
    if (!modeId) return c.json({ error: 'modeId required' }, 400)
    const b = reg.forSession(id)
    if (!b.setMode) return c.json({ error: 'mode switching not supported' }, 404)
    await b.setMode(id, modeId)
    return c.json({ ok: true })
  })

  app.post('/api/session/:id/model', async (c) => {
    const id = c.req.param('id')
    const { modelId } = await c.req.json<{ modelId?: string }>().catch(() => ({ modelId: undefined }))
    if (!modelId) return c.json({ error: 'modelId required' }, 400)
    const b = reg.forSession(id)
    if (!b.setModel) return c.json({ error: 'model switching not supported' }, 404)
    await b.setModel(id, modelId)
    return c.json({ ok: true })
  })
}
