import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createOpencodeBackend } from '../../src/core/agent/opencode-backend'

/**
 * Unit tests for OpencodeBackend — the concrete AgentBackend. The relay/route/
 * handler tests use a hand-written fakeBackend (they test callers against the
 * interface); THIS file is the missing layer: it drives the real
 * createOpencodeBackend() with a fake OpencodeClient returning raw opencode
 * shapes and asserts the normalized outputs (the parsing that moved here during
 * the AgentBackend migration). See docs/ACP_BACKEND_DESIGN.md.
 */
function fakeClient(over: any = {}) {
  const session = {
    promptAsync: vi.fn().mockResolvedValue({ data: {} }),
    list: vi.fn().mockResolvedValue({ data: [] }),
    get: vi.fn().mockResolvedValue({ data: {} }),
    message: vi.fn().mockResolvedValue({ data: { parts: [] } }),
    messages: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn().mockResolvedValue({ data: { id: 'ses_new' } }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    update: vi.fn().mockResolvedValue({ data: {} }),
    abort: vi.fn().mockResolvedValue({ data: {} }),
    status: vi.fn().mockResolvedValue({ data: { healthy: true } }),
    diff: vi.fn().mockResolvedValue({ data: [{ file: 'a.ts' }] }),
    todo: vi.fn().mockResolvedValue({ data: [{ content: 'todo' }] }),
    command: vi.fn().mockResolvedValue({ data: {} }),
    ...(over.session ?? {}),
  }
  return {
    session,
    config: {
      get: vi.fn().mockResolvedValue({ data: {} }),
      providers: vi.fn().mockResolvedValue({ data: { providers: [] } }),
      ...(over.config ?? {}),
    },
    command: { list: vi.fn().mockResolvedValue({ data: [] }), ...(over.command ?? {}) },
    project: { list: vi.fn().mockResolvedValue({ data: [] }) },
    postSessionIdPermissionsPermissionId: vi.fn().mockResolvedValue({ data: {} }),
    ...over.root,
  } as any
}

describe('OpencodeBackend', () => {
  it('reports id + capabilities (tuiSelect gated on baseUrl)', () => {
    const withUrl = createOpencodeBackend({ client: fakeClient(), baseUrl: 'http://x' })
    expect(withUrl.id).toBe('opencode')
    expect(withUrl.capabilities).toEqual({ liveMirror: true, tuiSelect: true, workspaces: true, diff: true, todos: true, catalog: true, mcp: true, commands: true })
    const noUrl = createOpencodeBackend({ client: fakeClient() })
    expect(noUrl.capabilities.tuiSelect).toBe(false)
  })

  it('prompt → SDK promptAsync with text part + agent/model', async () => {
    const client = fakeClient()
    const b = createOpencodeBackend({ client })
    await b.prompt('ses_1', { text: 'hi', agent: 'build', model: { providerID: 'p', modelID: 'm' } })
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'ses_1' },
        body: expect.objectContaining({
          parts: [{ type: 'text', text: 'hi' }],
          agent: 'build',
          model: { providerID: 'p', modelID: 'm' },
        }),
      }),
    )
  })

  it('listSessions maps raw {time,parentID} → SessionRef', async () => {
    const client = fakeClient({ session: {
      list: vi.fn().mockResolvedValue({ data: [{ id: 's1', parentID: 'p', time: { created: 1, updated: 2 } }] }),
    } })
    const refs = await createOpencodeBackend({ client }).listSessions()
    expect(refs).toEqual([{ id: 's1', parentID: 'p', createdAt: 1, updatedAt: 2 }])
  })

  it('listSessionSummaries filters children/stale/empty and maps fields (cost undefined)', async () => {
    const now = Date.now()
    const sessions = [
      { id: 'active', title: 'A', time: { created: now - 1000, updated: now - 1000 }, agent: { name: 'build' }, model: 'prov/k2', directory: '/repo', summary: { additions: 5, deletions: 2 } },
      { id: 'child', parentID: 'active', title: 'sub', time: { created: now, updated: now } },           // excluded: subagent
      { id: 'emptyFresh', time: { created: now - 1000, updated: now - 1000 } },                          // visible: empty within grace
      { id: 'emptyStale', time: { created: now - 2 * 3600_000, updated: now - 2 * 3600_000 } },          // excluded: empty past grace
      { id: 'staleActive', title: 'old', time: { created: now - 20 * 86_400_000, updated: now - 20 * 86_400_000 } }, // excluded: idle >14d
    ]
    const client = fakeClient({ session: { list: vi.fn().mockResolvedValue({ data: sessions }) } })
    const out = await createOpencodeBackend({ client }).listSessionSummaries()
    const ids = out.map((s) => s.id).sort()
    expect(ids).toEqual(['active', 'emptyFresh'])
    const active = out.find((s) => s.id === 'active')!
    expect(active).toMatchObject({
      title: 'A', agent: 'build', model: 'prov/k2', cost: undefined,
      directory: '/repo', additions: 5, deletions: 2, unread: false,
    })
  })

  it('getSessionMeta normalizes cost/tokens/agent/model (model basename)', async () => {
    const client = fakeClient({ session: {
      get: vi.fn().mockResolvedValue({ data: { cost: 0.04, tokens: { input: 100, output: 50 }, agent: { name: 'build' }, model: 'prov/k2p6' } }),
    } })
    const meta = await createOpencodeBackend({ client }).getSessionMeta('s')
    expect(meta).toEqual({ cost: 0.04, tokens: { input: 100, output: 50 }, agent: 'build', model: 'k2p6' })
  })

  it('getSessionMeta tolerates missing fields', async () => {
    const meta = await createOpencodeBackend({ client: fakeClient() }).getSessionMeta('s')
    expect(meta).toEqual({})
  })

  it('getContext maps the opencode-derived fields', async () => {
    const client = fakeClient({ session: {
      get: vi.fn().mockResolvedValue({ data: { agent: { name: 'plan' }, model: 'prov/x', tokens: { input: 1 }, cost: 0.1, directory: '/d' } }),
    } })
    const ctx = await createOpencodeBackend({ client }).getContext('s')
    expect(ctx).toEqual({ agent: 'plan', model: 'prov/x', tokens: { input: 1 }, cost: 0.1, directory: '/d' })
  })

  it('getMessageBlocks maps text + tool parts with status normalization', async () => {
    const client = fakeClient({ session: {
      message: vi.fn().mockResolvedValue({ data: { parts: [
        { type: 'text', text: 'hello' },
        { type: 'tool', tool: 'bash', state: { status: 'completed', input: { cmd: 'ls' } } },
        { type: 'tool', tool: 'edit', state: { status: 'error' } },
        { type: 'tool', tool: 'read', state: { status: 'running' } },
      ] } }),
    } })
    const blocks = await createOpencodeBackend({ client }).getMessageBlocks('s', 'm')
    expect(blocks).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'tool', tool: 'bash', args: 'ls', status: 'done' },
      { type: 'tool', tool: 'edit', args: '', status: 'error' },
      { type: 'tool', tool: 'read', args: '', status: 'running' },
    ])
  })

  it('getAgents filters agents without a model and maps name/model/description', async () => {
    const client = fakeClient({ config: {
      get: vi.fn().mockResolvedValue({ data: { agent: {
        build: { model: 'prov/k2', description: 'builder' },
        plan: { model: 'prov/o', description: '' },
        broken: { description: 'no model' },
      } } }),
    } })
    const agents = await createOpencodeBackend({ client }).getAgents()
    expect(agents).toEqual([
      { name: 'build', model: 'prov/k2', description: 'builder' },
      { name: 'plan', model: 'prov/o', description: '' },
    ])
  })

  it('getAgents/getModels/getMcp pass the directory query through', async () => {
    const client = fakeClient()
    const b = createOpencodeBackend({ client })
    await b.getAgents('/dir')
    await b.getMcp('/dir')
    await b.getModels('/dir')
    expect(client.config.get).toHaveBeenCalledWith({ query: { directory: '/dir' } })
    expect(client.config.providers).toHaveBeenCalledWith({ query: { directory: '/dir' } })
  })

  it('getModels maps providers + model records to arrays', async () => {
    const client = fakeClient({ config: {
      providers: vi.fn().mockResolvedValue({ data: { providers: [
        { id: 'p1', name: 'P1', models: { m1: { name: 'Model 1' }, m2: {} } },
      ] } }),
    } })
    const models = await createOpencodeBackend({ client }).getModels()
    expect(models).toEqual([
      { id: 'p1', name: 'P1', models: [{ id: 'm1', name: 'Model 1' }, { id: 'm2', name: 'm2' }] },
    ])
  })

  it('getMcp maps the config mcp map with enabled→status', async () => {
    const client = fakeClient({ config: {
      get: vi.fn().mockResolvedValue({ data: { mcp: { a: { type: 'local', enabled: true }, b: { enabled: false }, c: {} } } }),
    } })
    const mcp = await createOpencodeBackend({ client }).getMcp()
    expect(mcp).toEqual([
      { name: 'a', type: 'local', status: 'configured' },
      { name: 'b', type: undefined, status: 'disabled' },
      { name: 'c', type: undefined, status: 'configured' },
    ])
  })

  it('listWorkspaces merges project worktrees + session dirs', async () => {
    const client = fakeClient({
      session: { list: vi.fn().mockResolvedValue({ data: [{ id: 's1', directory: '/repo', time: { updated: 5 } }] }) },
      root: { project: { list: vi.fn().mockResolvedValue({ data: [{ worktree: '/repo' }] }) } },
    })
    const ws = await createOpencodeBackend({ client }).listWorkspaces()
    expect(ws).toContainEqual({ directory: '/repo', name: 'repo', sessionCount: 1, lastActiveAt: 5 })
  })

  it('listCommands maps name/description', async () => {
    const client = fakeClient({ command: {
      list: vi.fn().mockResolvedValue({ data: [{ name: 'init', description: 'd' }, { name: 'x' }] }),
    } })
    const cmds = await createOpencodeBackend({ client }).listCommands()
    expect(cmds).toEqual([{ name: 'init', description: 'd' }, { name: 'x', description: '' }])
  })

  it('write/forwarding methods call the right SDK endpoints', async () => {
    const client = fakeClient()
    const b = createOpencodeBackend({ client })
    await b.createSession({ directory: '/d', title: 'T' })
    expect(client.session.create).toHaveBeenCalledWith(expect.objectContaining({ query: { directory: '/d' }, body: { title: 'T' } }))
    await b.deleteSession('s'); expect(client.session.delete).toHaveBeenCalledWith({ path: { id: 's' } })
    await b.renameSession('s', 'NT'); expect(client.session.update).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 's' }, body: { title: 'NT' } }))
    await b.abort('s'); expect(client.session.abort).toHaveBeenCalledWith({ path: { id: 's' } })
    await b.runCommand('s', 'build', 'now'); expect(client.session.command).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 's' }, body: { command: 'build', arguments: 'now' } }))
    await b.resolvePermission('s', 'req1', 'always')
    expect(client.postSessionIdPermissionsPermissionId).toHaveBeenCalledWith({ path: { id: 's', permissionID: 'req1' }, body: { response: 'always' } })
  })

  it('createSession throws when the SDK returns no id', async () => {
    const client = fakeClient({ session: { create: vi.fn().mockResolvedValue({ data: {} }) } })
    await expect(createOpencodeBackend({ client }).createSession({ directory: '/d' })).rejects.toThrow(/create failed/)
  })

  it('hasSession reflects get success/failure; ping reflects status', async () => {
    const ok = createOpencodeBackend({ client: fakeClient({ session: { get: vi.fn().mockResolvedValue({ data: { id: 's' } }) } }) })
    expect(await ok.hasSession('s')).toBe(true)
    const bad = createOpencodeBackend({ client: fakeClient({ session: { get: vi.fn().mockRejectedValue(new Error('404')) } }) })
    expect(await bad.hasSession('s')).toBe(false)
    expect(await ok.ping()).toBe(true)
    const down = createOpencodeBackend({ client: fakeClient({ session: { status: vi.fn().mockRejectedValue(new Error('down')) } }) })
    expect(await down.ping()).toBe(false)
  })

  it('getDiff/getTodos/getSessionsStatus pass through data', async () => {
    const b = createOpencodeBackend({ client: fakeClient() })
    expect(await b.getDiff('s')).toEqual([{ file: 'a.ts' }])
    expect(await b.getTodos('s')).toEqual([{ content: 'todo' }])
    expect(await b.getSessionsStatus()).toEqual({ healthy: true })
  })

  describe('selectTuiSession', () => {
    beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })) })
    afterEach(() => { vi.unstubAllGlobals() })

    it('POSTs to <baseUrl>/tui/select-session when baseUrl is set', async () => {
      const b = createOpencodeBackend({ client: fakeClient(), baseUrl: 'http://host:4096/' })
      await b.selectTuiSession!('ses_x')
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://host:4096/tui/select-session',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ sessionID: 'ses_x' }) }),
      )
    })

    it('is a no-op without baseUrl', async () => {
      const b = createOpencodeBackend({ client: fakeClient() })
      await b.selectTuiSession!('ses_x')
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })
})
