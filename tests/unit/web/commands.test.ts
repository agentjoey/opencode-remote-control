import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { singleBackendRegistry } from '../../../src/core/agent/registry'
import { registerCommands } from '../../../src/transport/web/routes/commands'

describe('commands routes', () => {
  it('GET /api/commands lists opencode commands', async () => {
    const backend = { listCommands: async () => [{ name: 'review', description: 'Review code' }] } as any
    const app = new Hono(); registerCommands(app, singleBackendRegistry(backend))
    const res = await app.request('/api/commands')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ name: 'review', description: 'Review code' }])
  })
  it('POST /api/command runs a command on a session', async () => {
    const runCommand = vi.fn(async () => {})
    const app = new Hono(); registerCommands(app, singleBackendRegistry({ listCommands: vi.fn(), runCommand } as any))
    const res = await app.request('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'ses_1', command: 'review', arguments: 'x' }) })
    expect(res.status).toBe(200)
    expect(runCommand).toHaveBeenCalledWith('ses_1', 'review', 'x')
  })
  it('POST /api/command 400s without sessionId or command', async () => {
    const app = new Hono(); registerCommands(app, singleBackendRegistry({ listCommands: vi.fn(), runCommand: vi.fn() } as any))
    const res = await app.request('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(400)
  })
})
