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
  getDiff(id: string): Promise<unknown[]>
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
