import { describe, it, expect, vi } from 'vitest'
import { buildServer } from '../../../src/transport/web/server'
import { createTokenAuth } from '../../../src/connectivity/auth/token'
import { singleBackendRegistry } from '../../../src/core/agent/registry'

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
    getSessionBackend: () => undefined,
    setSessionBackend: vi.fn(),
    getActiveBackend: () => undefined,
    setActiveBackend: vi.fn(),
    flush: async () => {},
    _costs: costs,
  } as any
}

function fakeBackend(overrides: Record<string, any> = {}) {
  return {
    id: 'opencode',
    capabilities: { liveMirror: false, tuiSelect: false },
    listSessionSummaries: vi.fn().mockResolvedValue([
      { id: 'ses_a', title: 'A', lastActiveAt: Date.now() - 1000, unread: false, agent: 'build', model: 'k2p6' },
      { id: 'ses_b', title: 'B', lastActiveAt: Date.now() - 3000, unread: false, agent: 'plan' },
    ]),
    listSessions: vi.fn().mockResolvedValue([{ id: 'ses_a' }, { id: 'ses_b' }]),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockResolvedValue([
      { kind: 'user', blocks: [{ type: 'text', text: 'hi' }] },
    ]),
    abort: vi.fn().mockResolvedValue(undefined),
    getDiff: vi.fn().mockResolvedValue([{ path: 'a.ts', patch: '@@' }]),
    getContext: vi.fn().mockResolvedValue({
      agent: 'build', model: 'kimi/k2p6',
      tokens: { input: 5000, output: 2000 }, cost: 0.04,
      directory: '/home/u/proj',
    }),
    getMcp: vi.fn().mockResolvedValue([
      { name: 'github', type: 'remote', status: 'configured' },
      { name: 'figma', type: 'local', status: 'disabled' },
    ]),
    getAgents: vi.fn().mockResolvedValue([
      { name: 'build', model: 'kimi/k2p6', description: 'code' },
      { name: 'plan', model: 'google/g3', description: '' },
    ]),
    getModels: vi.fn().mockResolvedValue([
      { id: 'kimi', name: 'Kimi', models: [{ id: 'k2p6', name: 'K2 P6' }] },
    ]),
    resolvePermission: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue({ id: 'ses_new' }),
    renameSession: vi.fn().mockResolvedValue(undefined),
    listCommands: vi.fn().mockResolvedValue([]),
    runCommand: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    hasSession: vi.fn().mockResolvedValue(true),
    getSessionMeta: vi.fn().mockResolvedValue({}),
    getMessageBlocks: vi.fn().mockResolvedValue([]),
    getTodos: vi.fn().mockResolvedValue([]),
    getSessionsStatus: vi.fn().mockResolvedValue({}),
    ping: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as any
}

const baseOpts = (state: any, backend: any) => ({
  auth: createTokenAuth({ token: 'test-token', devBypass: true, devEmail: 'd@l', host: '127.0.0.1' }),
  registry: singleBackendRegistry(backend), state,
  cardBus: { publish: vi.fn(), subscribeAll: () => () => {}, currentSeq: () => 7 } as any,
  wsHub: { subscribe: () => () => {}, broadcast: vi.fn() } as any,
  cacheSize: 100,
  baseUrl: 'http://localhost:4096',
})

const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } }

describe('web routes', () => {
  it('GET /api/backends lists backends + active; POST sets the active backend', async () => {
    const { createBackendRegistry } = await import('../../../src/core/agent/registry')
    let active: string | undefined
    const state = { ...fakeState(), getActiveBackend: () => active, setActiveBackend: (b: string) => { active = b } } as any
    const oc = fakeBackend(); const kimi = fakeBackend(); kimi.id = 'acp:kimi'; kimi.capabilities = { ...kimi.capabilities, commands: true }
    const registry = createBackendRegistry({ state, backends: [{ id: 'opencode', backend: oc }, { id: 'acp:kimi', backend: kimi }] })
    const app = buildServer({ ...baseOpts(state, oc), registry } as any)

    const list = await (await app.request('/api/backends', undefined, LOOPBACK)).json() as any
    expect(list.backends.map((b: any) => b.id)).toEqual(['opencode', 'acp:kimi'])
    expect(list.activeId).toBe('opencode')

    const set = await app.request('/api/backends/active', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backendId: 'acp:kimi' }), ...LOOPBACK } as any)
    expect(set.status).toBe(200)
    expect(active).toBe('acp:kimi')

    const bad = await app.request('/api/backends/active', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backendId: 'ghost' }), ...LOOPBACK } as any)
    expect(bad.status).toBe(400)
  })

  it('GET /api/sessions returns bot-touched sessions sorted by created desc', async () => {
    const app = buildServer(baseOpts(fakeState(), fakeBackend()))
    const res = await app.request('/api/sessions', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body[0].id).toBe('ses_a')
    expect(body[0].cost).toBe(0.1)
  })

  it('POST /api/sessions/:id/delete deletes the session', async () => {
    const backend = fakeBackend()
    const app = buildServer(baseOpts(fakeState(), backend))
    const res = await app.request('/api/sessions/ses_a/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }, LOOPBACK)
    expect(res.status).toBe(200)
    expect(backend.deleteSession).toHaveBeenCalledWith('ses_a')
  })

  it('GET /api/session/:id returns history cards + lastSeq', async () => {
    const app = buildServer(baseOpts(fakeState(), fakeBackend()))
    const res = await app.request('/api/session/ses_a', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const body = await res.json() as { cards: any[]; lastSeq: number }
    expect(body.cards[0].kind).toBe('user')
    expect(body.lastSeq).toBe(7)
  })

  it('POST /api/message accepts a prompt', async () => {
    const state = fakeState(); const backend = fakeBackend()
    const opts = baseOpts(state, backend)
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

  it('POST /api/abort aborts locally AND tells opencode to stop generating', async () => {
    const state = fakeState()
    const ac = { abort: vi.fn() }
    state.getActiveAbort = () => ac as any
    const backend = fakeBackend()
    const app = buildServer(baseOpts(state, backend))
    const res = await app.request('/api/abort', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_a' }),
    }, LOOPBACK)
    expect(res.status).toBe(200)
    expect(ac.abort).toHaveBeenCalled()
    expect(backend.abort).toHaveBeenCalledWith('ses_a')
  })

  it('GET /api/session/:id/diff passes through to opencode', async () => {
    const backend = fakeBackend({
      getDiff: vi.fn().mockResolvedValue([{ path: 'a.ts', patch: '@@' }]),
    })
    const app = buildServer(baseOpts(fakeState(), backend))
    const res = await app.request('/api/session/ses_a/diff', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    expect((await res.json() as any[])[0].path).toBe('a.ts')
  })

  it('GET /api/session/:id/context composes session state', async () => {
    const backend = fakeBackend({
      getContext: vi.fn().mockResolvedValue({
        agent: 'build', model: 'kimi/k2p6',
        tokens: { input: 5000, output: 2000 }, cost: 0.04,
        directory: '/home/u/proj',
      }),
    })
    const app = buildServer(baseOpts(fakeState(), backend))
    const res = await app.request('/api/session/ses_a/context', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const ctx = await res.json() as any
    expect(ctx.agent).toBe('build')
    expect(ctx.cost).toBe(0.04)
    expect(ctx.directory).toBe('/home/u/proj')
  })

  it('GET /api/mcp lists configured MCP servers', async () => {
    const backend = fakeBackend({
      getMcp: vi.fn().mockResolvedValue([
        { name: 'github', type: 'remote', status: 'configured' },
        { name: 'figma', type: 'local', status: 'disabled' },
      ]),
    })
    const app = buildServer(baseOpts(fakeState(), backend))
    const res = await app.request('/api/mcp', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { name: 'github', type: 'remote', status: 'configured' },
      { name: 'figma', type: 'local', status: 'disabled' },
    ])
  })

  it('GET /api/agents returns configured agents (name, model, description)', async () => {
    const backend = fakeBackend({
      getAgents: vi.fn().mockResolvedValue([
        { name: 'build', model: 'kimi/k2p6', description: 'code' },
        { name: 'plan', model: 'google/g3', description: '' },
      ]),
    })
    const app = buildServer(baseOpts(fakeState(), backend))
    const res = await app.request('/api/agents', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body).toContainEqual({ name: 'build', model: 'kimi/k2p6', description: 'code' })
    expect(body).toContainEqual({ name: 'plan', model: 'google/g3', description: '' })
  })

  it('GET /api/models returns providers with their models', async () => {
    const backend = fakeBackend({
      getModels: vi.fn().mockResolvedValue([
        { id: 'kimi', name: 'Kimi', models: [{ id: 'k2p6', name: 'K2 P6' }] },
      ]),
    })
    const app = buildServer(baseOpts(fakeState(), backend))
    const res = await app.request('/api/models', undefined, LOOPBACK)
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body[0]).toMatchObject({ id: 'kimi', name: 'Kimi' })
    expect(body[0].models).toContainEqual({ id: 'k2p6', name: 'K2 P6' })
  })

  it('GET /api/overrides returns current next agent/model', async () => {
    const state = fakeState()
    state.getNextAgent = () => 'build'
    state.getNextModel = () => ({ providerID: 'kimi', modelID: 'k2p6' })
    const app = buildServer(baseOpts(state, fakeBackend()))
    const res = await app.request('/api/overrides', undefined, LOOPBACK)
    expect(await res.json()).toEqual({ agent: 'build', model: { providerID: 'kimi', modelID: 'k2p6' } })
  })

  it('POST /api/overrides sets agent + model on state', async () => {
    const state = fakeState()
    const app = buildServer(baseOpts(state, fakeBackend()))
    const res = await app.request('/api/overrides', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'plan', model: { providerID: 'google', modelID: 'g3' } }),
    }, LOOPBACK)
    expect(res.status).toBe(200)
    expect(state.setNextAgent).toHaveBeenCalledWith('plan')
    expect(state.setNextModel).toHaveBeenCalledWith({ providerID: 'google', modelID: 'g3' })
  })

  it('POST /api/overrides with nulls clears them', async () => {
    const state = fakeState()
    const app = buildServer(baseOpts(state, fakeBackend()))
    await app.request('/api/overrides', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: null, model: null }),
    }, LOOPBACK)
    expect(state.setNextAgent).toHaveBeenCalledWith(undefined)
    expect(state.setNextModel).toHaveBeenCalledWith(undefined)
  })

  it('POST /api/approval proxies the decision to opencode', async () => {
    const backend = fakeBackend()
    const app = buildServer(baseOpts(fakeState(), backend))
    const res = await app.request('/api/approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_a', requestId: 'r1', decision: 'once' }),
    }, LOOPBACK)
    expect(res.status).toBe(200)
    expect(backend.resolvePermission).toHaveBeenCalledWith('ses_a', 'r1', 'once')
  })
})
