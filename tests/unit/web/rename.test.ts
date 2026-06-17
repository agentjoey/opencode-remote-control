import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { registerRename } from '../../../src/transport/web/routes/rename'

describe('POST /api/sessions/:id/rename', () => {
  it('updates the session title', async () => {
    const renameSession = vi.fn(async () => {})
    const app = new Hono(); registerRename(app, { renameSession } as any)
    const res = await app.request('/api/sessions/ses_1/rename', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'New Name' }),
    })
    expect(res.status).toBe(200)
    expect(renameSession).toHaveBeenCalledWith('ses_1', 'New Name')
  })
  it('400s on empty title', async () => {
    const app = new Hono(); registerRename(app, { renameSession: vi.fn() } as any)
    const res = await app.request('/api/sessions/ses_1/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '  ' }) })
    expect(res.status).toBe(400)
  })
})
