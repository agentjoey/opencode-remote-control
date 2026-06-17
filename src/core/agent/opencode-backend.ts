/**
 * OpencodeBackend — AgentBackend over the opencode SDK + plugin. This is the only
 * backend today; it keeps every opencode-specific shape (session/message JSON,
 * the raw `tui/select-session` POST, config/provider maps) behind the interface so
 * the relay and transports stay backend-agnostic. See docs/ACP_BACKEND_DESIGN.md.
 */
import type { OpencodeClient } from '@opencode-ai/sdk'
import type {
  AgentBackend, AgentInfo, BackendCapabilities, CommandInfo, McpServer, ModelProvider,
  PermissionDecision, PromptInput, SessionContext, SessionMeta, SessionRef, SessionSummary,
} from './backend.js'
import type { ContentBlock, StructuredCard } from '../structured-card.js'
import { submitPrompt } from '../../opencode/submit.js'
import { listAllSessions } from '../../opencode/list-sessions.js'
import { listWorkspaces as listWorkspacesImpl } from '../../opencode/workspaces.js'
import { cardsFromMessages } from '../history.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('opencode-backend')

// Sidebar hygiene (epoch ms). Matches the previous fetchSessionSummaries rules.
const STALE_MS = 14 * 24 * 60 * 60 * 1000
const EMPTY_GRACE_MS = 60 * 60 * 1000

function isEmptySession(s: any): boolean {
  const created = s.time?.created ?? 0
  const updated = s.time?.updated ?? created
  return !s.title && updated === created
}

export interface OpencodeBackendDeps {
  client: OpencodeClient
  /** opencode server base URL — used to navigate the TUI (`tui/select-session`). */
  baseUrl?: string
}

export function createOpencodeBackend(deps: OpencodeBackendDeps): AgentBackend {
  const { client, baseUrl } = deps

  const capabilities: BackendCapabilities = {
    liveMirror: true, // opencode mirrors the user's live local session
    tuiSelect: !!baseUrl,
  }

  async function prompt(sessionId: string, input: PromptInput): Promise<void> {
    await submitPrompt(client, {
      text: input.text,
      sessionId,
      agent: input.agent,
      model: input.model,
      signal: input.signal,
    })
  }

  async function abort(id: string): Promise<void> {
    try {
      await client.session.abort({ path: { id } })
    } catch {
      /* best-effort */
    }
  }

  async function hasSession(id: string): Promise<boolean> {
    try {
      const res = await client.session.get({ path: { id } })
      return !!res.data
    } catch {
      return false
    }
  }

  async function listSessions(): Promise<SessionRef[]> {
    const sessions = (await listAllSessions(client)) as Array<{
      id: string; parentID?: string; time?: { created?: number; updated?: number }
    }>
    return sessions.map((s) => ({
      id: s.id, parentID: s.parentID, createdAt: s.time?.created, updatedAt: s.time?.updated,
    }))
  }

  async function listSessionSummaries(): Promise<SessionSummary[]> {
    const all = await listAllSessions(client)
    const now = Date.now()
    const roots = all.filter((s) => !s.parentID) // subagent children never shown
    const visible: any[] = []
    for (const s of roots) {
      const created = s.time?.created ?? 0
      const updated = s.time?.updated ?? created
      if (isEmptySession(s)) {
        if (now - created > EMPTY_GRACE_MS) continue // hide stale empties (non-destructive)
        visible.push(s); continue
      }
      if (now - updated > STALE_MS) continue // hide long-idle (non-destructive)
      visible.push(s)
    }
    visible.sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
    // cost is OCRC state, not an opencode field — left undefined here; the caller
    // merges it from SessionState.getSessionCost().
    return visible.map((s) => ({
      id: s.id,
      title: s.title ?? '',
      agent: typeof s.agent === 'string' ? s.agent : s.agent?.name,
      model: typeof s.model === 'string' ? s.model : s.model?.id,
      cost: undefined,
      lastActiveAt: s.time?.updated ?? s.time?.created ?? 0,
      unread: false,
      directory: typeof s.directory === 'string' ? s.directory : undefined,
      additions: s.summary?.additions,
      deletions: s.summary?.deletions,
    }))
  }

  async function createSession(opts: { directory: string; title?: string }): Promise<{ id: string }> {
    // `as any`: the SDK's create() type omits the `directory` query param, but
    // opencode accepts it (creates the session in that directory).
    const res = await client.session.create({
      query: { directory: opts.directory },
      body: opts.title ? { title: opts.title } : {},
    } as any)
    const id = (res.data as { id?: string } | undefined)?.id
    if (!id) throw new Error('create failed')
    return { id }
  }

  async function deleteSession(id: string): Promise<void> {
    await client.session.delete({ path: { id } })
  }

  async function renameSession(id: string, title: string): Promise<void> {
    await client.session.update({ path: { id }, body: { title } } as any)
  }

  async function getSessionMeta(id: string): Promise<SessionMeta> {
    const meta: SessionMeta = {}
    try {
      const s = ((await client.session.get({ path: { id } })).data ?? {}) as any
      if (typeof s.cost === 'number') meta.cost = s.cost
      const tin = typeof s.tokens?.input === 'number' ? s.tokens.input : undefined
      const tout = typeof s.tokens?.output === 'number' ? s.tokens.output : undefined
      if (tin !== undefined && tout !== undefined) meta.tokens = { input: tin, output: tout }
      if (s.agent?.name) meta.agent = s.agent.name
      if (typeof s.model === 'string') meta.model = s.model.split('/').pop() ?? s.model
    } catch { /* optional */ }
    return meta
  }

  async function getContext(id: string): Promise<SessionContext> {
    const s = ((await client.session.get({ path: { id } })).data ?? {}) as any
    return {
      agent: s.agent?.name,
      model: typeof s.model === 'string' ? s.model : undefined,
      tokens: s.tokens,
      cost: typeof s.cost === 'number' ? s.cost : undefined, // caller falls back to state
      directory: typeof s.directory === 'string' ? s.directory : undefined,
    }
  }

  async function getHistory(id: string, limit?: number): Promise<StructuredCard[]> {
    const res = await client.session.messages({ path: { id } })
    const messages = (res.data ?? []) as any[]
    return cardsFromMessages(id, messages, limit)
  }

  async function getMessageBlocks(sessionId: string, messageId: string): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = []
    try {
      const m = ((await client.session.message({ path: { id: sessionId, messageID: messageId } })).data ?? {}) as any
      for (const part of m.parts ?? []) {
        if (part.type === 'text' && typeof part.text === 'string') blocks.push({ type: 'text', text: part.text })
        if (part.type === 'tool' && typeof part.tool === 'string') {
          const st = part.state?.status ?? 'running'
          blocks.push({
            type: 'tool', tool: part.tool,
            args: String(part.state?.input?.cmd ?? part.state?.input ?? '').slice(0, 60),
            status: st === 'error' ? 'error' : st === 'done' || st === 'completed' ? 'done' : 'running',
          })
        }
      }
    } catch (err) {
      log.info('getMessageBlocks fallback fetch failed', (err as Error).message)
    }
    return blocks
  }

  async function getDiff(id: string): Promise<unknown[]> {
    const res = await (client.session as any).diff({ path: { id } } as any)
    return (res.data ?? []) as unknown[]
  }

  async function getTodos(id: string): Promise<unknown[]> {
    const res = await (client.session as any).todo({ path: { id } } as any)
    return (res.data ?? []) as unknown[]
  }

  async function getSessionsStatus(): Promise<unknown> {
    return (await client.session.status()).data
  }

  async function ping(): Promise<boolean> {
    try { await client.session.status(); return true } catch { return false }
  }

  async function getAgents(directory?: string): Promise<AgentInfo[]> {
    let agents: Record<string, { model?: string; description?: string }> = {}
    try { agents = (((await client.config.get(directory ? { query: { directory } } : {})).data as any)?.agent ?? {}) } catch { /* empty */ }
    return Object.entries(agents)
      .filter(([, v]) => typeof v?.model === 'string')
      .map(([name, v]) => ({ name, model: v!.model as string, description: v?.description ?? '' }))
  }

  async function getModels(directory?: string): Promise<ModelProvider[]> {
    let providers: Array<{ id: string; name: string; models: Record<string, { name?: string }> }> = []
    try { providers = (((await client.config.providers(directory ? { query: { directory } } : {})).data as any)?.providers ?? []) } catch { /* empty */ }
    return providers.map((p) => ({
      id: p.id, name: p.name,
      models: Object.entries(p.models ?? {}).map(([id, m]) => ({ id, name: m?.name ?? id })),
    }))
  }

  async function getMcp(directory?: string): Promise<McpServer[]> {
    let mcp: Record<string, { type?: string; enabled?: boolean }> = {}
    try { mcp = (((await client.config.get(directory ? { query: { directory } } : {})).data as any)?.mcp ?? {}) } catch { /* empty */ }
    return Object.entries(mcp).map(([name, v]) => ({
      name, type: v?.type, status: v?.enabled === false ? 'disabled' : 'configured',
    }))
  }

  function listWorkspaces() {
    return listWorkspacesImpl(client)
  }

  async function listCommands(): Promise<CommandInfo[]> {
    const data = ((await client.command.list()).data ?? []) as Array<{ name: string; description?: string }>
    return data.map((d) => ({ name: d.name, description: d.description ?? '' }))
  }

  async function runCommand(id: string, command: string, args?: string): Promise<void> {
    await client.session.command({ path: { id }, body: { command, arguments: args ?? '' } } as any)
  }

  async function resolvePermission(id: string, requestId: string, decision: PermissionDecision): Promise<void> {
    await (client as any).postSessionIdPermissionsPermissionId({
      path: { id, permissionID: requestId },
      body: { response: decision },
    })
  }

  /** Navigate the TUI via POST /tui/select-session (SDK v1 has no typed method). */
  async function selectTuiSession(id: string, signal?: AbortSignal): Promise<void> {
    if (!baseUrl) return
    try {
      const normalized = baseUrl.replace(/\/+$/, '')
      const timeoutSignal = AbortSignal.timeout(2000)
      const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      const res = await fetch(`${normalized}/tui/select-session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionID: id }), signal: combined,
      })
      if (!res.ok) log.debug(`tui/select-session HTTP ${res.status}`)
    } catch (err) {
      log.debug(`tui/select-session skipped: ${(err as Error).message}`)
    }
  }

  return {
    id: 'opencode',
    capabilities,
    prompt, abort,
    hasSession, listSessions, listSessionSummaries, createSession, deleteSession, renameSession,
    getSessionMeta, getContext, getHistory, getMessageBlocks, getDiff, getTodos, getSessionsStatus, ping,
    getAgents, getModels, getMcp, listWorkspaces, listCommands, runCommand,
    resolvePermission,
    selectTuiSession,
  }
}
