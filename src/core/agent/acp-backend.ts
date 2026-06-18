/**
 * AcpBackend — AgentBackend over an ACP agent (Kimi/Gemini/Cursor/Codex/Claude)
 * spoken over stdio via @agentclientprotocol/sdk. Unlike OpencodeBackend, this
 * backend OWNS its event source: the ClientSideConnection delivers `session/update`
 * notifications to OUR client callbacks, which we normalize (acp-normalizer) and
 * fan out through `onEvent`. The host wires `onEvent → relay.handleEvent`.
 *
 * Validated against live `kimi acp` — see docs/ACP_BACKEND_DESIGN.md §12b.
 *
 * Many AgentBackend reads (diff/todos/models/workspaces/history/mcp/agents) have
 * no ACP equivalent; they return degraded-empty values and the UI gates them off
 * via `capabilities`. The core turn + session + streaming + permission path is real.
 */
import type {
  AgentBackend, AgentInfo, BackendCapabilities, CommandInfo, McpServer, ModelProvider,
  PermissionDecision, PromptInput, SessionContext, SessionMeta, SessionRef, SessionSummary,
  Workspace,
} from './backend.js'
import type { ContentBlock, StructuredCard } from '../structured-card.js'
import type { AgentEvent } from './event.js'
import { createAcpNormalizer, type AcpUpdate } from './acp-normalizer.js'
import type { AcpStore } from './acp-store.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('acp-backend')

/** A pending permission request surfaced to OCRC's approval flow. */
export interface AcpPermissionRequest {
  sessionId: string
  /** ACP toolCallId — used as the requestId in resolvePermission. */
  requestId: string
  title: string
  options: Array<{ optionId: string; kind?: string; name?: string }>
}

/** The slice of an ACP ClientSideConnection AcpBackend depends on (injectable). */
export interface AcpConnection {
  newSession(p: { cwd: string; mcpServers: unknown[] }): Promise<{ sessionId: string }>
  loadSession?(p: { sessionId: string; cwd: string; mcpServers: unknown[] }): Promise<unknown>
  /** Re-establish a previously-created session (kimi persists these across connections). */
  resumeSession?(p: { sessionId: string; cwd: string; mcpServers: unknown[] }): Promise<unknown>
  listSessions?(p?: unknown): Promise<{ sessions?: Array<{ sessionId: string; title?: string }> }>
  deleteSession?(p: { sessionId: string }): Promise<unknown>
  authenticate(p: { methodId: string }): Promise<unknown>
  prompt(p: { sessionId: string; prompt: Array<{ type: 'text'; text: string }> }): Promise<{ stopReason: string }>
  cancel(p: { sessionId: string }): Promise<unknown>
}

/** Our ACP client handlers — the connection calls these as the agent streams. */
export interface AcpClient {
  sessionUpdate(p: { sessionId: string; update: AcpUpdate }): Promise<void>
  requestPermission(p: {
    sessionId: string
    toolCall: { toolCallId: string; title: string }
    options: Array<{ optionId: string; kind?: string; name?: string }>
  }): Promise<{ outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } }>
}

/**
 * Establishes the connection. Given OUR client handlers, returns a live
 * AcpConnection. Production spawns `kimi acp` and builds a ClientSideConnection;
 * tests inject a fake that lets them drive `client.sessionUpdate(...)` directly.
 * `authRequired` is true when initialize advertised authMethods that we must
 * satisfy (attempt-then-authenticate happens in the factory or backend).
 */
export type AcpConnectFactory = (client: AcpClient) => Promise<{
  conn: AcpConnection
  /** First advertised auth method id, if initialize reported any. */
  authMethodId?: string
}>

export interface AcpBackendDeps {
  /** Stable id, e.g. 'acp:kimi'. */
  id: string
  /** Working directory passed to newSession. */
  cwd: string
  connect: AcpConnectFactory
  /**
   * Bridge an ACP permission request to OCRC's approval flow. Resolves to the
   * chosen ACP optionId (or null to cancel). When omitted, the backend
   * auto-rejects (safe default). The Telegram/Web permission UI provides this.
   */
  onPermission?: (req: AcpPermissionRequest) => Promise<string | null>
  /**
   * Persistent session+history store. ACP agents don't expose a session list or
   * replay history, so OCRC persists both here to give kimi sessions the same
   * long-lived, reopenable experience as opencode. When omitted, sessions are
   * in-memory only (lost on restart).
   */
  store?: AcpStore
}

export function createAcpBackend(deps: AcpBackendDeps): AgentBackend {
  const { id, cwd, store } = deps
  const normalizer = createAcpNormalizer()
  const listeners = new Set<(e: AgentEvent) => void>()
  /** Sessions established in THIS process (so we know when to resume from the store). */
  const sessions = new Set<string>()
  /** Pending permission requests keyed by `${sessionId}:${toolCallId}`. */
  const pendingPerms = new Map<string, {
    resolve: (optionId: string | null) => void
    options: Array<{ optionId: string; kind?: string; name?: string }>
  }>()

  /** Map an OCRC decision → the ACP optionId by the option's `kind`. */
  function optionForDecision(
    options: Array<{ optionId: string; kind?: string; name?: string }>,
    decision: PermissionDecision,
  ): string | null {
    if (decision === 'reject') {
      const o = options.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always' || /reject|deny|no/i.test(o.name ?? ''))
      return o?.optionId ?? null
    }
    const wantKind = decision === 'always' ? 'allow_always' : 'allow_once'
    const o = options.find((o) => o.kind === wantKind)
      ?? options.find((o) => o.kind?.startsWith('allow'))
      ?? options.find((o) => /allow|approve|yes|once/i.test(o.name ?? ''))
    return o?.optionId ?? null
  }

  const capabilities: BackendCapabilities = {
    liveMirror: false, // ACP agents have no concurrent local TUI session to mirror
    tuiSelect: false,
    workspaces: false, // ACP has no workspace enumeration
    diff: false,
    todos: false,
    catalog: false, // models come per-session from newSession, not a global catalog
    mcp: false,
    commands: true, // populated from available_commands_update; run via slash-prompt
  }

  // Latest slash-commands the agent advertised (available_commands_update).
  let commands: CommandInfo[] = []

  function emit(e: AgentEvent): void {
    for (const fn of listeners) {
      try { fn(e) } catch (err) { log.warn(`onEvent listener threw: ${String(err)}`) }
    }
  }

  // Our ACP client: connection drives these as the agent streams.
  const client: AcpClient = {
    async sessionUpdate({ sessionId, update }) {
      if (update.sessionUpdate === 'available_commands_update' && Array.isArray(update.availableCommands)) {
        commands = update.availableCommands.map((c) => ({ name: c.name, description: c.description ?? '' }))
        return
      }
      const ae = normalizer.normalize(sessionId, update)
      if (ae) emit(ae)
    },
    async requestPermission({ sessionId, toolCall, options }) {
      const key = `${sessionId}:${toolCall.toolCallId}`
      const req: AcpPermissionRequest = { sessionId, requestId: toolCall.toolCallId, title: toolCall.title, options }
      let chosen: string | null = null
      try {
        if (deps.onPermission) {
          // Whichever resolves first wins: onPermission returning an optionId
          // directly, or the host calling resolvePermission(key) out-of-band.
          chosen = await new Promise<string | null>((resolve) => {
            pendingPerms.set(key, { resolve, options })
            deps.onPermission!(req).then(resolve).catch(() => resolve(null))
          })
        }
      } finally {
        pendingPerms.delete(key)
      }
      if (chosen) return { outcome: { outcome: 'selected', optionId: chosen } }
      return { outcome: { outcome: 'cancelled' } }
    },
  }

  // Lazy single connection.
  let connP: Promise<{ conn: AcpConnection; authMethodId?: string }> | undefined
  function connection() {
    if (!connP) connP = deps.connect(client)
    return connP
  }

  async function ensureSession(sessionId: string, conn: AcpConnection): Promise<void> {
    if (sessions.has(sessionId)) return
    // Persisted session from a prior process (host restart) → resume it so the
    // agent re-establishes context, then we can prompt it again.
    if (conn.resumeSession) {
      try { await conn.resumeSession({ sessionId, cwd, mcpServers: [] }); sessions.add(sessionId); return } catch (err) { log.warn(`resumeSession failed: ${String(err)}`) }
    }
    if (conn.loadSession) {
      try { await conn.loadSession({ sessionId, cwd, mcpServers: [] }); sessions.add(sessionId) } catch { /* not loadable */ }
    }
  }

  async function prompt(sessionId: string, input: PromptInput): Promise<void> {
    const { conn } = await connection()
    await ensureSession(sessionId, conn)
    // ACP `prompt` resolves only at stopReason — kick it off in the background
    // and surface completion/error as idle/error events (the relay's contract).
    conn.prompt({ sessionId, prompt: [{ type: 'text', text: input.text }] })
      .then(() => { emit({ kind: 'idle', sessionId }); normalizer.reset(sessionId) })
      .catch((err) => {
        emit({ kind: 'error', sessionId, message: err?.message ?? String(err) })
        normalizer.reset(sessionId)
      })
    // Resolve immediately: the turn was accepted, the response streams via events.
  }

  async function abort(sessionId: string): Promise<void> {
    try {
      const { conn } = await connection()
      await conn.cancel({ sessionId })
    } catch (err) { log.warn(`abort failed: ${String(err)}`) }
  }

  async function createSession(opts: { directory: string; title?: string }): Promise<{ id: string }> {
    const { conn } = await connection()
    const res = await conn.newSession({ cwd: opts.directory || cwd, mcpServers: [] })
    sessions.add(res.sessionId)
    store?.create(res.sessionId, opts.title ?? '')
    return { id: res.sessionId }
  }

  /** Session ids known across restarts: the persistent store ∪ this process. */
  function knownIds(): string[] {
    const ids = new Set<string>(sessions)
    if (store) for (const s of store.list()) ids.add(s.id)
    return [...ids]
  }

  async function listSessions(): Promise<SessionRef[]> {
    return knownIds().map((id) => ({ id }))
  }

  async function listSessionSummaries(): Promise<SessionSummary[]> {
    if (store) {
      return store.list().map((s) => ({ id: s.id, title: s.title, lastActiveAt: s.updatedAt, unread: false, directory: cwd }))
    }
    return [...sessions].map((id) => ({ id, title: '', lastActiveAt: 0, unread: false, directory: cwd }))
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const { conn } = await connection()
    if (conn.deleteSession) { try { await conn.deleteSession({ sessionId }) } catch { /* best-effort */ } }
    sessions.delete(sessionId)
    store?.remove(sessionId)
    normalizer.drop(sessionId)
  }

  async function resolvePermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void> {
    const key = `${sessionId}:${requestId}`
    const pending = pendingPerms.get(key)
    if (!pending) { log.warn(`resolvePermission: no pending request ${key}`); return }
    pending.resolve(optionForDecision(pending.options, decision))
  }

  // ── degraded reads (no ACP equivalent; UI gates via capabilities) ───────────
  const EMPTY = async () => []
  const backend: AgentBackend = {
    id,
    capabilities,
    prompt,
    abort,
    hasSession: async (sid: string) => sessions.has(sid) || (store?.has(sid) ?? false),
    listSessions,
    listSessionSummaries,
    createSession,
    deleteSession,
    renameSession: async (sid: string, title: string) => { store?.rename(sid, title) },
    getSessionMeta: async (): Promise<SessionMeta> => ({}),
    getContext: async (): Promise<SessionContext> => ({ directory: cwd }),
    // History is OCRC-persisted (ACP doesn't replay it): return stored cards.
    getHistory: async (sid: string): Promise<StructuredCard[]> => store?.getCards(sid) ?? [],
    getMessageBlocks: async (): Promise<ContentBlock[]> => [],
    getDiff: EMPTY,
    getTodos: EMPTY,
    getSessionsStatus: async () => ({}),
    ping: async () => { try { await connection(); return true } catch { return false } },
    getAgents: async (): Promise<AgentInfo[]> => [],
    getModels: async (): Promise<ModelProvider[]> => [],
    getMcp: async (): Promise<McpServer[]> => [],
    listWorkspaces: async (): Promise<Workspace[]> => [],
    listCommands: async (): Promise<CommandInfo[]> => commands,
    runCommand: async (sessionId: string, command: string, args?: string) => {
      // ACP has no dedicated command RPC; agents accept slash-commands as prompt
      // text. Submit `/name [args]` as a turn (streams + idle via the event path).
      const text = `/${command}${args ? ' ' + args : ''}`
      await prompt(sessionId, { text })
    },
    resolvePermission,
    onEvent(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  return backend
}
