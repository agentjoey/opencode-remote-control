import { describe, it, expect, vi } from 'vitest'
import { buildServer } from '../../../src/transport/web/server'

function fakeState() {
  const costs = new Map<string, number>([['ses_a', 0.1], ['ses_b', 0.05]])
  return {
    getSessionCost: (id: string) => costs.get(id),
    setSessionCost: vi.fn(),
    getLastSessionId: () => 'ses_a',
    getActiveAbort: (id: string) => id === 'ses_a' ? { abort: vi.fn() } as any : undefined,
    setActiveAbort: vi.fn(),
    getNextAgent: () => undefined,
    getNextModel: () => undefined,
    setNextAgent: vi.fn(),
    setNextModel: vi.fn(),
    getCurrentAgent: () => undefined,
    setCurrentAgent: vi.fn(),
    getTuiSelectedSession: () => undefined,
    setTuiSelectedSession: vi.fn(),
    setLastSessionId: vi.fn(),
    flush: async () => {},
    _costs: costs,
  } as any
}

function fakeClient() {
  return {
    session: {
      list: vi.fn().mockResolvedValue({ data: [
        { id: 'ses_a', time: { created: 200 }, agent: { name: 'build' }, model: 'k2p6' },
        { id: 'ses_b', time: { created: 100 }, agent: { name: 'plan' } },
      ]}),
      messages: vi.fn().mockResolvedValue({ data: [
        { role: 'user', parts: [{ type: 'text', text: 'hi' }], ts: 1 },
      ]}),
      promptAsync: vi.fn().mockResolvedValue({ data: { messageID: 'msg_1' } }),
    },
  } as any
}

const baseOpts = (state: any, client: any) => ({
  cfAccess: { team: '', aud: '', devBypass: true, devEmail: 'd@l', host: '127.0.0.1' },
  client, state,
  cardBus: { publish: vi.fn(), subscribeAll: () => () => {}, currentSeq: () => 7 } as any,
  wsHub: { subscribe: () => () => {}, broadcast: vi.fn() } as any,
  cacheSize: 100,
  baseUrl: 'http://localhost:4096',
})

// dev bypass now requires a loopback socket peer (not opts.host), so every
// request must present a 127.0.0.1 peer to pass cfAccessMiddleware.
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } }

describe('web routes', () => {
  it('GET /api/sessions returns bot-touched sessions sorted by created desc', async () => {
    const app = buildServer(baseOpts(fakeState(), fakeClient()))
    const res = await app.request('/api/sessions', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body[0].id).toBe('ses_a')
    expect(body[0].cost).toBe(0.1)
  })

  it('GET /api/session/:id returns history cards + lastSeq', async () => {
    const app = buildServer(baseOpts(fakeState(), fakeClient()))
    const res = await app.request('/api/session/ses_a', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const body = await res.json() as { cards: any[]; lastSeq: number }
    expect(body.cards[0].kind).toBe('user')
    expect(body.lastSeq).toBe(7)
  })

  it('POST /api/message accepts a prompt', async () => {
    const state = fakeState(); const client = fakeClient()
    const opts = baseOpts(state, client)
    const messageHandler = vi.fn(async () => {})
    const app = buildServer({ ...opts, onMessage: messageHandler } as any)
    const res = await app.request('/api/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_a', text: 'go' }),
    }, LOOPBACK)
    expect(res.status).toBe(200)
    expect(messageHandler).toHaveBeenCalled()
  })

  it('POST /api/abort triggers the active controller', async () => {
    const state = fakeState()
    const ac = { abort: vi.fn() }
    state.getActiveAbort = () => ac as any
    const app = buildServer(baseOpts(state, fakeClient()))
    const res = await app.request('/api/abort', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_a' }),
    }, LOOPBACK)
    expect(res.status).toBe(200)
    expect(ac.abort).toHaveBeenCalled()
  })

  it('GET /api/session/:id/diff passes through to opencode', async () => {
    const client = {
      session: {
        ...fakeClient().session,
        diff: vi.fn().mockResolvedValue({ data: [{ path: 'a.ts', patch: '@@' }] }),
      },
    } as any
    const app = buildServer(baseOpts(fakeState(), client))
    const res = await app.request('/api/session/ses_a/diff', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    expect((await res.json() as any[])[0].path).toBe('a.ts')
  })

  it('GET /api/session/:id/context composes session state', async () => {
    const client = {
      session: {
        ...fakeClient().session,
        get: vi.fn().mockResolvedValue({ data: {
          agent: { name: 'build' }, model: 'kimi/k2p6',
          tokens: { input: 5000, output: 2000 }, cost: 0.04,
        }}),
      },
    } as any
    const app = buildServer(baseOpts(fakeState(), client))
    const res = await app.request('/api/session/ses_a/context', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const ctx = await res.json() as any
    expect(ctx.agent).toBe('build')
    expect(ctx.cost).toBe(0.04)
  })

  it('GET /api/mcp lists configured MCP servers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      mcp: { github: { type: 'remote' }, figma: { type: 'local', enabled: false } },
    }) }))
    const app = buildServer(baseOpts(fakeState(), fakeClient()))
    const res = await app.request('/api/mcp', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body).toEqual([
      { name: 'github', type: 'remote', status: 'configured' },
      { name: 'figma', type: 'local', status: 'disabled' },
    ])
    vi.unstubAllGlobals()
  })

  it('GET /api/agents returns configured agents (name, model, description)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      agent: { build: { model: 'kimi/k2p6', description: 'code' }, plan: { model: 'google/g3' } },
    }) }))
    const app = buildServer(baseOpts(fakeState(), fakeClient()))
    const res = await app.request('/api/agents', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body).toContainEqual({ name: 'build', model: 'kimi/k2p6', description: 'code' })
    expect(body).toContainEqual({ name: 'plan', model: 'google/g3', description: '' })
    vi.unstubAllGlobals()
  })

  it('GET /api/models returns providers with their models', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      providers: [{ id: 'kimi', name: 'Kimi', models: { k2p6: { name: 'K2 P6' } } }],
    }) }))
    const app = buildServer(baseOpts(fakeState(), fakeClient()))
    const res = await app.request('/api/models', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body[0]).toMatchObject({ id: 'kimi', name: 'Kimi' })
    expect(body[0].models).toContainEqual({ id: 'k2p6', name: 'K2 P6' })
    vi.unstubAllGlobals()
  })

  it('POST /api/approval proxies the decision to opencode', async () => {
    const respond = vi.fn().mockResolvedValue({})
    const client = { ...fakeClient(), postSessionIdPermissionsPermissionId: respond } as any
    const app = buildServer(baseOpts(fakeState(), client))
    const res = await app.request('/api/approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_a', requestId: 'r1', decision: 'once' }),
    }, LOOPBACK)
    expect(res.status).toBe(200)
    expect(respond).toHaveBeenCalled()
  })
})
