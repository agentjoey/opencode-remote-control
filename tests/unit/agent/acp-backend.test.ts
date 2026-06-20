import { describe, it, expect, vi } from 'vitest'
import { createAcpBackend, type AcpClient, type AcpConnection } from '../../../src/core/agent/acp-backend'
import type { AgentEvent } from '../../../src/core/agent/event'

/** A fake ACP connection that captures our client so tests can drive updates. */
function makeHarness(opts: { promptResult?: Promise<{ stopReason: string }> } = {}) {
  let client!: AcpClient
  const promptCalls: Array<{ sessionId: string; text: string }> = []
  const cancelCalls: string[] = []
  const conn: AcpConnection = {
    newSession: vi.fn(async () => ({ sessionId: 'ses_new' })),
    listSessions: vi.fn(async () => ({ sessions: [{ sessionId: 'ses_1', title: 'One' }] })),
    deleteSession: vi.fn(async () => ({})),
    authenticate: vi.fn(async () => ({})),
    prompt: vi.fn(async (p: { sessionId: string; prompt: Array<{ text: string }> }) => {
      promptCalls.push({ sessionId: p.sessionId, text: p.prompt[0].text })
      return opts.promptResult ? await opts.promptResult : { stopReason: 'end_turn' }
    }),
    cancel: vi.fn(async (p: { sessionId: string }) => { cancelCalls.push(p.sessionId); return {} }),
  }
  const connect = async (c: AcpClient) => { client = c; return { conn, authMethodId: 'login' } }
  return { connect, conn, promptCalls, cancelCalls, getClient: () => client }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('createAcpBackend', () => {
  it('reports ACP capabilities (no live mirror / tui select)', () => {
    const h = makeHarness()
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    expect(b.id).toBe('acp:kimi')
    expect(b.capabilities).toEqual({ liveMirror: false, tuiSelect: false, workspaces: true, freeformWorkspace: true, diff: true, todos: true, catalog: false, mcp: false, commands: true })
  })

  it('createSession returns the agent sessionId and tracks it', async () => {
    const h = makeHarness()
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    const { id } = await b.createSession({ directory: '/work' })
    expect(id).toBe('ses_new')
    expect(h.conn.newSession).toHaveBeenCalledWith({ cwd: '/work', mcpServers: [] })
    expect(await b.hasSession('ses_new')).toBe(true)
  })

  it('streams normalized events from session updates via onEvent', async () => {
    // prompt stays pending so only streaming events are observed (no idle yet)
    const h = makeHarness({ promptResult: new Promise(() => {}) })
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    const events: AgentEvent[] = []
    b.onEvent!((e) => events.push(e))
    await b.prompt('ses_a', { text: 'hi' })
    // drive an agent message chunk through our client (as the connection would)
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } } })
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' world' } } })
    expect(events).toEqual([
      { kind: 'part', sessionId: 'ses_a', part: { id: 'ses_a:text:0', type: 'text', text: 'Hello' } },
      { kind: 'delta', sessionId: 'ses_a', partId: 'ses_a:text:0', text: ' world' },
    ])
  })

  it('emits idle when the prompt turn completes', async () => {
    const h = makeHarness()
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    const events: AgentEvent[] = []
    b.onEvent!((e) => events.push(e))
    await b.prompt('ses_a', { text: 'hi' })
    await flush() // let the backgrounded prompt() promise settle
    expect(h.promptCalls).toEqual([{ sessionId: 'ses_a', text: 'hi' }])
    expect(events).toContainEqual({ kind: 'idle', sessionId: 'ses_a' })
  })

  it('emits error when the prompt turn rejects', async () => {
    const h = makeHarness({ promptResult: Promise.reject(new Error('boom')) })
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    const events: AgentEvent[] = []
    b.onEvent!((e) => events.push(e))
    await b.prompt('ses_a', { text: 'hi' })
    await flush()
    expect(events).toContainEqual({ kind: 'error', sessionId: 'ses_a', message: 'boom' })
  })

  it('resets per-turn part ids across turns (idle bumps the turn)', async () => {
    const h = makeHarness()
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    const events: AgentEvent[] = []
    b.onEvent!((e) => events.push(e))
    await b.prompt('ses_a', { text: 'turn1' })
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'agent_message_chunk', content: { text: 'a' } } })
    await flush() // idle fires → normalizer.reset
    await b.prompt('ses_a', { text: 'turn2' })
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'agent_message_chunk', content: { text: 'b' } } })
    const parts = events.filter((e) => e.kind === 'part') as Extract<AgentEvent, { kind: 'part' }>[]
    expect(parts.map((p) => p.part.id)).toEqual(['ses_a:text:0', 'ses_a:text:1'])
  })

  it('abort cancels the session', async () => {
    const h = makeHarness()
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    await b.createSession({ directory: '/tmp' })
    await b.abort('ses_new')
    expect(h.cancelCalls).toEqual(['ses_new'])
  })

  it('bridges a permission request to onPermission and maps the decision to an optionId', async () => {
    const h = makeHarness()
    const onPermission = vi.fn(async () => 'approve_for_session')
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect, onPermission })
    await b.prompt('ses_a', { text: 'run it' })
    const outcome = await h.getClient().requestPermission({
      sessionId: 'ses_a',
      toolCall: { toolCallId: 'tc_1', title: 'Shell: echo hi' },
      options: [
        { optionId: 'approve', kind: 'allow_once' },
        { optionId: 'approve_for_session', kind: 'allow_always' },
        { optionId: 'reject', kind: 'reject_once' },
      ],
    })
    expect(onPermission).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'ses_a', requestId: 'tc_1' }))
    expect(outcome).toEqual({ outcome: { outcome: 'selected', optionId: 'approve_for_session' } })
  })

  it('resolvePermission maps an OCRC decision → ACP optionId by kind', async () => {
    const h = makeHarness()
    // onPermission never resolves on its own — host drives it via resolvePermission
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect, onPermission: () => new Promise<string | null>(() => {}) })
    const permP = h.getClient!() // ensure connected
    await b.prompt('ses_a', { text: 'run it' })
    const outcomeP = h.getClient().requestPermission({
      sessionId: 'ses_a',
      toolCall: { toolCallId: 'tc_9', title: 'Shell' },
      options: [
        { optionId: 'approve', kind: 'allow_once' },
        { optionId: 'approve_for_session', kind: 'allow_always' },
        { optionId: 'reject', kind: 'reject_once' },
      ],
    })
    await flush()
    await b.resolvePermission('ses_a', 'tc_9', 'always')
    expect(await outcomeP).toEqual({ outcome: { outcome: 'selected', optionId: 'approve_for_session' } })
    void permP
  })

  it('rejects by default when no onPermission bridge is provided', async () => {
    const h = makeHarness()
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    await b.prompt('ses_a', { text: 'x' })
    const outcome = await h.getClient().requestPermission({
      sessionId: 'ses_a',
      toolCall: { toolCallId: 'tc_1', title: 'Shell' },
      options: [{ optionId: 'approve', kind: 'allow_once' }],
    })
    expect(outcome).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('captures available_commands_update into listCommands', async () => {
    const h = makeHarness({ promptResult: new Promise(() => {}) })
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    await b.prompt('ses_a', { text: 'hi' }) // forces connection so the client exists
    expect(await b.listCommands()).toEqual([])
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact the context' }, { name: 'clear' }] } })
    expect(await b.listCommands()).toEqual([
      { name: 'compact', description: 'Compact the context' },
      { name: 'clear', description: '' },
    ])
  })

  it('captures ACP plan updates into getTodos (full replace per update)', async () => {
    const h = makeHarness({ promptResult: new Promise(() => {}) })
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    await b.prompt('ses_a', { text: 'hi' })
    expect(await b.getTodos('ses_a')).toEqual([])
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'plan', entries: [
      { content: 'Read the file', status: 'completed' },
      { content: 'Edit it', status: 'in_progress' },
      { content: 'Run tests', status: 'pending' },
    ] } })
    expect(await b.getTodos('ses_a')).toEqual([
      { content: 'Read the file', status: 'completed' },
      { content: 'Edit it', status: 'in_progress' },
      { content: 'Run tests', status: 'pending' },
    ])
    // plan replaces wholesale
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'plan', entries: [{ content: 'Done', status: 'completed' }] } })
    expect(await b.getTodos('ses_a')).toEqual([{ content: 'Done', status: 'completed' }])
  })

  it('captures kimi-code 0.18 todo tool_call (rawInput.todos) into getTodos', async () => {
    const h = makeHarness({ promptResult: new Promise(() => {}) })
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    await b.prompt('ses_a', { text: 'hi' })
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc_todo', title: 'Updating todo list', rawInput: { todos: [
      { title: 'Read', status: 'done' },
      { title: 'Edit', status: 'in_progress' },
      { title: 'Test', status: 'pending' },
    ] } } })
    expect(await b.getTodos('ses_a')).toEqual([
      { content: 'Read', status: 'done' },
      { content: 'Edit', status: 'in_progress' },
      { content: 'Test', status: 'pending' },
    ])
  })

  it('accumulates tool_call diff content into getDiff (deduped by path)', async () => {
    const h = makeHarness({ promptResult: new Promise(() => {}) })
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    await b.prompt('ses_a', { text: 'hi' })
    expect(await b.getDiff('ses_a')).toEqual([])
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'tool_call', toolCallId: 'tc_1', title: 'Edit', content: [
      { type: 'diff', path: '/work/a.ts', oldText: 'x', newText: 'y' },
    ] } })
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc_2', title: 'Write', content: [
      { type: 'diff', path: '/work/b.ts', oldText: '', newText: 'new' },
    ] } })
    // re-editing the same path dedupes (keyed by path)
    await h.getClient().sessionUpdate({ sessionId: 'ses_a', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc_1', title: 'Edit', content: [
      { type: 'diff', path: '/work/a.ts', oldText: 'y', newText: 'z' },
    ] } })
    expect(await b.getDiff('ses_a')).toEqual([{ path: '/work/a.ts' }, { path: '/work/b.ts' }])
  })

  it('runCommand submits the slash-command as a prompt turn', async () => {
    const h = makeHarness({ promptResult: new Promise(() => {}) })
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    await b.runCommand('ses_a', 'compact', 'keep db')
    expect(h.promptCalls).toContainEqual({ sessionId: 'ses_a', text: '/compact keep db' })
  })

  it('without a store, listSessionSummaries reflects in-memory sessions', async () => {
    const h = makeHarness()
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    expect(await b.listSessionSummaries()).toEqual([])
    await b.createSession({ directory: '/tmp' }) // ses_new
    expect(await b.listSessionSummaries()).toEqual([{ id: 'ses_new', title: '', lastActiveAt: 0, unread: false, directory: '/tmp' }])
  })

  it('with a store, sessions + history persist (survive a fresh backend / restart)', async () => {
    const { createAcpStore } = await import('../../../src/core/agent/acp-store')
    const path = `/tmp/acp-store-test-${Math.floor(performance.now())}.json`
    const store = createAcpStore(path)

    const h = makeHarness()
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect, store })
    const { id } = await b.createSession({ directory: '/tmp', title: 'Chat' })
    // record a couple of finalized cards (the host does this from the cardBus)
    store.recordCard(id, { kind: 'user', sessionId: id, id: 'u1', text: 'hi', ts: 1 } as any, 100)
    store.recordCard(id, { kind: 'assistant', sessionId: id, id: 'a1', blocks: [{ type: 'text', text: 'hello' }] } as any, 200)
    await store.flush()

    // a FRESH backend (simulating a host restart) sees the session + history
    const h2 = makeHarness()
    const b2 = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h2.connect, store: createAcpStore(path) })
    expect((await b2.listSessionSummaries()).map((s) => ({ id: s.id, title: s.title }))).toEqual([{ id, title: 'Chat' }])
    expect(await b2.hasSession(id)).toBe(true)
    const hist = await b2.getHistory(id)
    expect(hist.map((c: any) => c.kind)).toEqual(['user', 'assistant'])
  })

  it('persists per-session directory; listWorkspaces derives dirs (+ cwd default)', async () => {
    const { createAcpStore } = await import('../../../src/core/agent/acp-store')
    const store = createAcpStore(`/tmp/acp-dir-${Math.floor(performance.now())}.json`)
    const h = makeHarness()
    let n = 0
    ;(h.conn as any).newSession = vi.fn(async (p: { cwd: string }) => ({ sessionId: `ses_${p.cwd.split('/').pop()}_${n++}` }))
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/home/me/default', connect: h.connect, store })

    // no sessions yet → workspaces is just the cwd default
    expect((await b.listWorkspaces()).map((w) => w.directory)).toEqual(['/home/me/default'])

    await b.createSession({ directory: '/work/proj-a' })
    await b.createSession({ directory: '/work/proj-a' }) // same dir, 2 sessions
    await b.createSession({ directory: '/work/proj-b' })
    const ws = await b.listWorkspaces()
    expect(ws.find((w) => w.directory === '/work/proj-a')?.sessionCount).toBe(2)
    expect(ws.find((w) => w.directory === '/work/proj-b')?.name).toBe('proj-b')
    // getContext returns the session's own directory
    expect((await b.getContext('ses_proj-a_0')).directory).toBe('/work/proj-a')
  })

  it('resumes a persisted session before prompting it (host restart continuity)', async () => {
    const { createAcpStore } = await import('../../../src/core/agent/acp-store')
    const store = createAcpStore(`/tmp/acp-resume-${Math.floor(performance.now())}.json`)
    store.create('ses_old', 'Old chat')
    const resumed: string[] = []
    const h = makeHarness({ promptResult: new Promise(() => {}) })
    ;(h.conn as any).resumeSession = vi.fn(async (p: { sessionId: string }) => { resumed.push(p.sessionId); return {} })
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect, store })
    await b.prompt('ses_old', { text: 'continue' })
    expect(resumed).toEqual(['ses_old']) // resumeSession called before the prompt
    expect(h.promptCalls).toContainEqual({ sessionId: 'ses_old', text: 'continue' })
  })
})
