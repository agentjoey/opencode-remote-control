/**
 * AgentBackend — the seam between OCRC's relay/transports and the underlying
 * coding agent. Today the only implementation is OpencodeBackend (wraps the
 * opencode SDK + plugin); the seam exists so a second backend (an ACP agent over
 * stdio — Kimi/Gemini/Cursor/Codex/Claude) can be added without touching the card
 * model or the Telegram/Web transports. See docs/ACP_BACKEND_DESIGN.md.
 *
 * Every opencode `client.*` call the relay/routes/handlers make is represented
 * here as a normalized method so callers never reach past the interface to a
 * concrete SDK. A few read methods (getDiff/getTodos/getSessionsStatus) are
 * opencode-shaped passthroughs for now (typed `unknown`); they get normalized
 * when ACP — which models diffs/plans/status differently — is added in Phase 2.
 */
import type { ContentBlock, StructuredCard } from '../structured-card.js'
import type { AgentEvent } from './event.js'

/** Minimal session identity used for fallback resolution (newest/root-first). */
export interface SessionRef {
  id: string
  parentID?: string
  createdAt?: number
  updatedAt?: number
}

/** Sidebar row. `cost` is filled by OCRC state (the backend leaves it undefined). */
export interface SessionSummary {
  id: string
  title?: string
  agent?: string
  model?: string
  cost?: number
  lastActiveAt: number
  unread: boolean
  directory?: string
  additions?: number
  deletions?: number
  /** Multi-backend: which backend owns this session (set by the aggregator). */
  backendId?: string
}

/** Normalized assistant-turn metadata for the final card. */
export interface SessionMeta {
  agent?: string
  model?: string
  cost?: number
  tokens?: { input: number; output: number }
}

/** Inspector "context" panel — the agent-derived fields (OCRC adds next* + state). */
export interface SessionContext {
  agent?: string
  model?: string
  tokens?: unknown
  cost?: number
  directory?: string
}

export interface AgentInfo { name: string; model: string; description: string }
export interface ModelProvider { id: string; name: string; models: Array<{ id: string; name: string }> }
export interface McpServer { name: string; type?: string; status: 'configured' | 'disabled' }
export interface CommandInfo { name: string; description: string }
export interface Workspace { directory: string; name: string; sessionCount: number; lastActiveAt: number }

/** One rendered line of a normalized diff. `text` carries no trailing newline. */
export interface DiffLine { kind: 'add' | 'del' | 'ctx'; text: string }
/** A normalized, render-ready per-file diff (returned by getDiff for every backend). */
export interface DiffEntry { path: string; additions: number; deletions: number; lines: DiffLine[] }

/** A selectable control value (a session mode, or a model). */
export interface ControlOption { id: string; name: string }
/**
 * A session's switchable mode + model (ACP `session/set_mode` + `set_config_option`).
 * Either may be absent when the backend/agent doesn't expose it.
 */
export interface SessionControls {
  mode?: { current?: string; options: ControlOption[] }
  model?: { current?: string; options: ControlOption[] }
}

export interface PromptInput {
  text: string
  agent?: string
  model?: { providerID: string; modelID: string }
  signal?: AbortSignal
}

export type PermissionDecision = 'once' | 'always' | 'reject'

/**
 * What a backend can do — read by the UI to degrade gracefully per backend.
 * Grows alongside the interface; only the flags needed so far are defined.
 */
export interface BackendCapabilities {
  /** Mirrors a concurrently-running *local* session (opencode plugin only). */
  liveMirror: boolean
  /** Can navigate a local TUI to a session (opencode `tui/select-session`). */
  tuiSelect: boolean
  /** Enumerates workspaces (directories with sessions) — gates the workspace switcher. */
  workspaces: boolean
  /**
   * New sessions take an arbitrary, user-entered working directory (ACP agents),
   * vs opencode where workspaces are enumerated projects you pick from. Drives
   * whether the new-session UI shows a free-form directory input or a picker.
   */
  freeformWorkspace: boolean
  /** Produces a working-dir diff — gates the diff panel. */
  diff: boolean
  /** Produces a todo/plan list — gates the task panel. */
  todos: boolean
  /** Exposes selectable agents/models — gates the agent/model override chip. */
  catalog: boolean
  /** Reports MCP servers — gates the MCP panel. */
  mcp: boolean
  /** Exposes slash-commands — gates the command-palette commands group. */
  commands: boolean
  /** Exposes switchable session mode + model — gates the mode/model pickers. */
  sessionControls: boolean
}

export interface AgentBackend {
  /** Stable backend id, e.g. 'opencode' | 'acp:kimi'. */
  readonly id: string
  readonly capabilities: BackendCapabilities

  // ── turn ──────────────────────────────────────────────────────────────────
  /** Submit a prompt turn; resolves on accept (response arrives via events). */
  prompt(sessionId: string, input: PromptInput): Promise<void>
  /** Stop server-side generation for a session. */
  abort(id: string): Promise<void>

  // ── sessions ────────────────────────────────────────────────────────────────
  hasSession(id: string): Promise<boolean>
  listSessions(): Promise<SessionRef[]>
  /** Sidebar summaries (cost left undefined — OCRC state fills it). */
  listSessionSummaries(): Promise<SessionSummary[]>
  createSession(opts: { directory: string; title?: string }): Promise<{ id: string }>
  deleteSession(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<void>

  // ── reads ─────────────────────────────────────────────────────────────────
  getSessionMeta(id: string): Promise<SessionMeta>
  getContext(id: string): Promise<SessionContext>
  /** Reconstructed conversation cards (tail-limited). */
  getHistory(id: string, limit?: number): Promise<StructuredCard[]>
  /** Blocks for one assistant message — streaming-accumulator fallback only. */
  getMessageBlocks(sessionId: string, messageId: string): Promise<ContentBlock[]>
  /** opencode-shaped diff payload (passthrough; normalized when ACP lands). */
  getDiff(id: string): Promise<DiffEntry[]>
  /** opencode-shaped todo payload (passthrough; → ACP plan later). */
  getTodos(id: string): Promise<unknown[]>
  /** Global/all-session status payload (passthrough; telegram `/status`). */
  getSessionsStatus(): Promise<unknown>
  /** Cheap liveness probe (the no-arg `session.status` health check). */
  ping(): Promise<boolean>

  // ── catalog / commands ──────────────────────────────────────────────────────
  getAgents(directory?: string): Promise<AgentInfo[]>
  getModels(directory?: string): Promise<ModelProvider[]>
  getMcp(directory?: string): Promise<McpServer[]>
  /** Workspaces (directories with sessions) across all opencode projects. */
  listWorkspaces(): Promise<Workspace[]>
  listCommands(): Promise<CommandInfo[]>
  runCommand(id: string, command: string, args?: string): Promise<void>

  // ── session controls (present only when capabilities.sessionControls) ────────
  /** Current switchable mode + model for a session (empty when nothing captured). */
  getControls?(id: string): Promise<SessionControls>
  /** Switch the session's operational mode. */
  setMode?(id: string, modeId: string): Promise<void>
  /** Switch the session's model. */
  setModel?(id: string, modelId: string): Promise<void>

  // ── permissions ─────────────────────────────────────────────────────────────
  resolvePermission(id: string, requestId: string, decision: PermissionDecision): Promise<void>

  // ── event source (backends that own their stream) ───────────────────────────
  /**
   * Subscribe to this backend's normalized event stream. Present only when the
   * backend OWNS its event source (e.g. AcpBackend driving a spawned ACP agent
   * over a ClientSideConnection). opencode omits this: its events arrive
   * out-of-band via the plugin `event` hook, which the host normalizes and feeds
   * to `relay.handleEvent` directly. Returns an unsubscribe fn.
   */
  onEvent?(handler: (e: AgentEvent) => void): () => void

  // ── opencode-only extras (present per capabilities) ─────────────────────────
  /** Navigate a local TUI to a session. Present only when capabilities.tuiSelect. */
  selectTuiSession?(id: string, signal?: AbortSignal): Promise<void>
}
