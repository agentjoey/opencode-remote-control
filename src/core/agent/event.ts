/**
 * AgentEvent — the normalized streaming event the relay consumes, independent of
 * the backend. opencode events and ACP `session/update` notifications both
 * normalize to this, so the relay's streaming/finalize logic stays
 * backend-agnostic. See docs/ACP_BACKEND_DESIGN.md (Phase 2).
 *
 * A "part" is one unit of a turn (a text block, a thought, or a tool call), keyed
 * by a stable `id` so re-deliveries replace in place and deltas append. This
 * mirrors how both opencode parts and ACP `session/update` chunks/tool-calls work.
 */

/** Normalized part state — already summarized (no backend-specific `state` object). */
export interface NormalizedPart {
  id: string
  type: 'text' | 'tool' | 'reasoning'
  /** Full text for text/reasoning parts (replace semantics). */
  text?: string
  /** Tool name for tool parts. */
  tool?: string
  /** One-line summarized tool args. */
  args?: string
  /** Tool lifecycle (already mapped from the backend's own status enum). */
  status?: 'running' | 'done' | 'error'
}

export type AgentEvent =
  /** A full part state (text/tool/reasoning) — replaces any prior state for `part.id`. */
  | { kind: 'part'; sessionId: string; messageId?: string; part: NormalizedPart }
  /** An append-only text delta for an existing text part. */
  | { kind: 'delta'; sessionId: string; messageId?: string; partId: string; text: string }
  /** The turn finished — finalize the assistant card. */
  | { kind: 'idle'; sessionId: string }
  /** The turn errored. */
  | { kind: 'error'; sessionId: string; message: string }
