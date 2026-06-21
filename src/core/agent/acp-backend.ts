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
import { buildDiffEntry } from './diff-util.js'
import { buildReplayCards } from './acp-replay.js'
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
  listSessions?(p?: { cwd?: string }): Promise<{ sessions?: Array<{ sessionId: string; title?: string; cwd?: string; updatedAt?: string }>; nextCursor?: string | null }>
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
  /**
   * Optional: extra working directories to query via `session/list`, so OCRC can
   * discover agent-native sessions (e.g. kimi TUI sessions) created in directories
   * OCRC never used itself. Best-effort + agent-specific — the host wires it.
   */
  discoverDirs?: () => string[]
}

export function createAcpBackend(deps: AcpBackendDeps): AgentBackend {
  const { id, cwd, store } = deps
  const normalizer = createAcpNormalizer()
  const listeners = new Set<(e: AgentEvent) => void>()
  /** Sessions established in THIS process (so we know when to resume from the store). */
  const sessions = new Set<string>()
  /** cwd of kimi-owned sessions OCRC didn't create — discovered via session/list
   *  (e.g. sessions you started in the kimi TUI). Lets us resume/open them. */
  const nativeDirs = new Map<string, string>()
  /** Session ids the user deleted — kimi has no session/delete, so we filter these
   *  out of session/list re-discovery (also persisted in the store). */
  const tombstones = new Set<string>()
  /** Pending permission requests keyed by `${sessionId}:${toolCallId}`. */
  const pendingPerms = new Map<string, {
    resolve: (optionId: string | null) => void
    options: Array<{ optionId: string; kind?: string; name?: string }>
  }>()
  /** Latest TODO list per session (ACP `plan`, full-replace) — served via getTodos. */
  const plans = new Map<string, Array<{ content: string; status: string }>>()
  /** Files edited per session, keyed by path (tool_call diff content) — served via getDiff. */
  const edits = new Map<string, Map<string, { oldText?: string; newText?: string }>>()
  /** Sessions being history-loaded: their replayed session/update stream is buffered
   *  here (→ buildReplayCards) instead of emitted as live events. */
  const replayBuffers = new Map<string, AcpUpdate[]>()

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
    workspaces: true, // OCRC persists per-session directories (see store)
    freeformWorkspace: true, // new sessions take a user-entered directory
    diff: true, // working-dir file list accumulated from tool_call diff content
    todos: true, // TODO list from ACP `plan` updates
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
      // History replay (session/load): buffer the replayed stream for getHistory, and
      // do NOT emit it as live events.
      const replay = replayBuffers.get(sessionId)
      if (replay) { replay.push(update); return }
      if (update.sessionUpdate === 'available_commands_update' && Array.isArray(update.availableCommands)) {
        commands = update.availableCommands.map((c) => ({ name: c.name, description: c.description ?? '' }))
        return
      }
      // plan: the agent's TODO list (full replace each update). Served via getTodos;
      // not a streaming part, so consume it here and stop.
      if (update.sessionUpdate === 'plan') {
        const entries = Array.isArray(update.entries) ? update.entries : []
        plans.set(sessionId, entries.map((e) => ({
          content: e.content ?? e.text ?? e.title ?? '',
          status: e.status ?? 'pending',
        })))
        return
      }
      // tool_call diff content → accumulate per-file edits (served via getDiff).
      // Still falls through to the normalizer so the tool card streams as usual.
      if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
        // kimi-code 0.18 ships the TODO list as a tool_call carrying rawInput.todos
        // (older agents send an ACP `plan` update — handled above). Either → getTodos.
        const todos = update.rawInput?.todos
        if (Array.isArray(todos)) {
          plans.set(sessionId, todos.map((t) => ({
            content: t.content ?? t.title ?? t.text ?? '',
            status: t.status ?? 'pending',
          })))
        }
        for (const it of Array.isArray(update.content) ? update.content : []) {
          if (it && it.type === 'diff' && it.path) {
            let m = edits.get(sessionId)
            if (!m) { m = new Map(); edits.set(sessionId, m) }
            m.set(it.path, { oldText: it.oldText, newText: it.newText })
          }
        }
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

  /** Working dir of a session: OCRC store, else native (TUI) cwd, else host default. */
  function dirOf(sid: string): string { return store?.directoryOf(sid) || nativeDirs.get(sid) || cwd }

  /** Rebuild a session's history by replaying it via session/load (kimi re-streams its
   *  past updates; we buffer them and build cards). For native/unstreamed sessions
   *  OCRC has no recorded cards for. Caches the result so later opens are instant. */
  async function loadHistory(sid: string): Promise<StructuredCard[]> {
    const { conn } = await connection()
    if (!conn.loadSession) return []
    const buffer: AcpUpdate[] = []
    replayBuffers.set(sid, buffer)
    try {
      await conn.loadSession({ sessionId: sid, cwd: dirOf(sid), mcpServers: [] })
      sessions.add(sid)
    } catch (err) { log.warn(`history loadSession failed: ${String(err)}`) }
    finally { replayBuffers.delete(sid) }
    const now = Date.now()
    const cards = buildReplayCards(sid, buffer, now)
    if (store) for (const c of cards) store.recordCard(sid, c, now)
    return cards
  }

  async function ensureSession(sessionId: string, conn: AcpConnection): Promise<void> {
    if (sessions.has(sessionId)) return
    // Persisted/native session (host restart, or created in the kimi TUI) → resume
    // it in ITS OWN directory so the agent re-establishes context, then prompt it.
    const sdir = dirOf(sessionId)
    if (conn.resumeSession) {
      try { await conn.resumeSession({ sessionId, cwd: sdir, mcpServers: [] }); sessions.add(sessionId); return } catch (err) { log.warn(`resumeSession failed: ${String(err)}`) }
    }
    if (conn.loadSession) {
      try { await conn.loadSession({ sessionId, cwd: sdir, mcpServers: [] }); sessions.add(sessionId) } catch { /* not loadable */ }
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
    const dir = opts.directory || cwd
    const { conn } = await connection()
    const res = await conn.newSession({ cwd: dir, mcpServers: [] })
    sessions.add(res.sessionId)
    store?.create(res.sessionId, opts.title ?? '', dir)
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

  /** Enumerate kimi's OWN sessions (incl. TUI-created) via session/list, which is
   *  per-cwd — so query every directory OCRC knows about, plus the host default. */
  async function listNativeSummaries(): Promise<SessionSummary[]> {
    let conn: AcpConnection
    try { conn = (await connection()).conn } catch { return [] }
    if (!conn.listSessions) return []
    const dirs = new Set<string>([cwd])
    for (const d of store?.listDirectories() ?? []) dirs.add(d.directory)
    for (const sid of sessions) { const d = store?.directoryOf(sid); if (d) dirs.add(d) }
    for (const d of deps.discoverDirs?.() ?? []) dirs.add(d) // agent-native dirs (e.g. kimi TUI)
    const out: SessionSummary[] = []
    for (const dir of dirs) {
      try {
        const res = await conn.listSessions({ cwd: dir })
        for (const s of res?.sessions ?? []) {
          if (tombstones.has(s.sessionId) || store?.isTombstoned(s.sessionId)) continue // user-deleted
          const d = s.cwd || dir
          nativeDirs.set(s.sessionId, d)
          out.push({ id: s.sessionId, title: s.title ?? '', lastActiveAt: s.updatedAt ? Date.parse(s.updatedAt) : 0, unread: false, directory: d })
        }
      } catch { /* this dir isn't listable — skip */ }
    }
    return out
  }

  async function listSessionSummaries(): Promise<SessionSummary[]> {
    const storeRows: SessionSummary[] = store
      ? store.list().map((s) => ({ id: s.id, title: s.title, lastActiveAt: s.updatedAt, unread: false, directory: s.directory || cwd }))
      : [...sessions].map((id) => ({ id, title: '', lastActiveAt: 0, unread: false, directory: cwd }))
    const native = await listNativeSummaries().catch(() => [])
    // Merge: native (kimi-owned, incl. TUI sessions) first, OCRC store overrides
    // (richer title/dir for sessions OCRC created). Dedup by id.
    const byId = new Map<string, SessionSummary>()
    for (const n of native) byId.set(n.id, n)
    for (const s of storeRows) byId.set(s.id, s)
    return [...byId.values()]
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const { conn } = await connection()
    if (conn.deleteSession) { try { await conn.deleteSession({ sessionId }) } catch { /* best-effort */ } }
    sessions.delete(sessionId)
    nativeDirs.delete(sessionId)
    plans.delete(sessionId)
    edits.delete(sessionId)
    tombstones.add(sessionId) // kimi has no session/delete → hide from re-discovery
    store?.tombstone(sessionId)
    normalizer.drop(sessionId)
  }

  async function resolvePermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void> {
    const key = `${sessionId}:${requestId}`
    const pending = pendingPerms.get(key)
    if (!pending) { log.warn(`resolvePermission: no pending request ${key}`); return }
    pending.resolve(optionForDecision(pending.options, decision))
  }

  // ── degraded reads (no ACP equivalent; UI gates via capabilities) ───────────
  const backend: AgentBackend = {
    id,
    capabilities,
    prompt,
    abort,
    hasSession: async (sid: string) => sessions.has(sid) || (store?.has(sid) ?? false) || nativeDirs.has(sid),
    listSessions,
    listSessionSummaries,
    createSession,
    deleteSession,
    renameSession: async (sid: string, title: string) => { store?.rename(sid, title) },
    getSessionMeta: async (): Promise<SessionMeta> => ({}),
    getContext: async (sid: string): Promise<SessionContext> => ({ directory: dirOf(sid) }),
    // History is OCRC-persisted (ACP doesn't replay it): return stored cards.
    getHistory: async (sid: string): Promise<StructuredCard[]> => {
      const cached = store?.getCards(sid)
      if (cached && cached.length) return cached
      return loadHistory(sid) // native/unstreamed session → replay via session/load
    },
    getMessageBlocks: async (): Promise<ContentBlock[]> => [],
    // Working-dir diff = the files the agent edited this session (from tool_call
    // diff content), each rendered to a normalized DiffEntry (red/green lines).
    getDiff: async (sid: string) =>
      [...(edits.get(sid)?.entries() ?? [])].map(([path, e]) => buildDiffEntry(path, e.oldText ?? '', e.newText ?? '')),
    // TODO list from ACP `plan` updates; summarizeTodos consumes {content,status}.
    getTodos: async (sid: string) => plans.get(sid) ?? [],
    getSessionsStatus: async () => ({}),
    ping: async () => { try { await connection(); return true } catch { return false } },
    getAgents: async (): Promise<AgentInfo[]> => [],
    getModels: async (): Promise<ModelProvider[]> => [],
    getMcp: async (): Promise<McpServer[]> => [],
    // Known directories (from persisted sessions) plus the host default cwd, so
    // the picker always offers at least the default. name = basename.
    listWorkspaces: async (): Promise<Workspace[]> => {
      const dirs = new Map<string, Workspace>()
      const add = (directory: string, sessionCount: number, lastActiveAt: number) => {
        if (!directory) return
        const name = directory.split('/').filter(Boolean).pop() ?? directory
        dirs.set(directory, { directory, name, sessionCount, lastActiveAt })
      }
      for (const d of store?.listDirectories() ?? []) add(d.directory, d.sessionCount, d.lastActiveAt)
      // agent-native workdirs (e.g. kimi TUI folders) so the picker offers them all
      for (const d of deps.discoverDirs?.() ?? []) if (!dirs.has(d)) add(d, 0, 0)
      for (const d of nativeDirs.values()) if (!dirs.has(d)) add(d, 0, 0)
      if (!dirs.has(cwd)) add(cwd, 0, 0)
      return [...dirs.values()]
    },
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
