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
    expect(b.capabilities).toEqual({ liveMirror: false, tuiSelect: false, workspaces: false, diff: false, todos: false, catalog: false, mcp: false, commands: true })
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

  it('runCommand submits the slash-command as a prompt turn', async () => {
    const h = makeHarness({ promptResult: new Promise(() => {}) })
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    await b.runCommand('ses_a', 'compact', 'keep db')
    expect(h.promptCalls).toContainEqual({ sessionId: 'ses_a', text: '/compact keep db' })
  })

  it('listSessionSummaries returns degraded-but-valid rows', async () => {
    const h = makeHarness()
    const b = createAcpBackend({ id: 'acp:kimi', cwd: '/tmp', connect: h.connect })
    const rows = await b.listSessionSummaries()
    expect(rows).toEqual([{ id: 'ses_1', title: 'One', lastActiveAt: 0, unread: false, directory: '/tmp' }])
  })
})
