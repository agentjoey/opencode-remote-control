/**
 * Map ACP `session/update` notifications → the normalized AgentEvent the relay
 * consumes. This is the ACP side of the Phase 2 event seam (mirrors
 * opencode-normalizer.ts). See docs/ACP_BACKEND_DESIGN.md §12b for the payload
 * shapes validated against live `kimi acp`.
 *
 * Unlike opencode, ACP text/thought chunks carry NO part id — they are raw
 * append-only deltas. So this normalizer is STATEFUL: it synthesizes a stable
 * per-turn part id per kind (text vs reasoning), emits `{kind:'part'}` on the
 * first chunk of that kind and `{kind:'delta'}` thereafter, and resets the turn
 * on `reset(sessionId)` (the backend calls this when the prompt resolves / idles).
 * Tool chunks DO carry `toolCallId`, so they key directly with no synthesis.
 */
import type { AgentEvent, NormalizedPart } from './event.js'

/** The subset of ACP `session/update` payloads we consume. */
export interface AcpUpdate {
  sessionUpdate: string
  /** message/thought chunk: a single content block. */
  content?: AcpContentLike
  /** tool_call / tool_call_update. */
  toolCallId?: string
  title?: string
  status?: string
  /** available_commands_update (not relay-relevant; surfaced via listCommands). */
  availableCommands?: Array<{ name: string; description?: string }>
}

type AcpContentLike =
  | { type?: string; text?: string }
  | Array<{ type?: string; content?: { type?: string; text?: string } }>

function chunkText(content: AcpContentLike | undefined): string {
  if (!content) return ''
  if (Array.isArray(content)) {
    return content.map((c) => c?.content?.text ?? '').join('')
  }
  return content.text ?? ''
}

/** Map ACP tool status enum → our lifecycle. */
function mapAcpToolStatus(s?: string): 'running' | 'done' | 'error' {
  if (s === 'failed' || s === 'error') return 'error'
  if (s === 'completed' || s === 'success' || s === 'done') return 'done'
  return 'running' // pending | in_progress | undefined
}

interface TurnState {
  /** Synthesized text part id for the current turn, once a text chunk arrives. */
  textPartId?: string
  /** Synthesized reasoning part id for the current turn. */
  reasoningPartId?: string
  /** Monotonic turn counter — bumped on reset so ids never collide across turns. */
  turn: number
}

export interface AcpNormalizer {
  /** Normalize one ACP update for a session, or null if not relay-relevant. */
  normalize(sessionId: string, update: AcpUpdate): AgentEvent | null
  /** End the current turn for a session (clears synthesized part ids, bumps turn). */
  reset(sessionId: string): void
  /** Drop all state for a session. */
  drop(sessionId: string): void
}

export function createAcpNormalizer(): AcpNormalizer {
  const turns = new Map<string, TurnState>()
  const stateFor = (sid: string): TurnState => {
    let t = turns.get(sid)
    if (!t) { t = { turn: 0 }; turns.set(sid, t) }
    return t
  }

  /** Emit part-on-first-chunk / delta-thereafter for the no-id text & reasoning streams. */
  function textLike(
    sid: string,
    type: 'text' | 'reasoning',
    text: string,
  ): AgentEvent | null {
    if (!text) return null
    const st = stateFor(sid)
    const key = type === 'text' ? 'textPartId' : 'reasoningPartId'
    let partId = st[key]
    if (!partId) {
      partId = `${sid}:${type}:${st.turn}`
      st[key] = partId
      const part: NormalizedPart = { id: partId, type, text }
      return { kind: 'part', sessionId: sid, part }
    }
    return { kind: 'delta', sessionId: sid, partId, text }
  }

  return {
    normalize(sessionId, update) {
      switch (update.sessionUpdate) {
        case 'agent_message_chunk':
          return textLike(sessionId, 'text', chunkText(update.content))
        case 'agent_thought_chunk':
          return textLike(sessionId, 'reasoning', chunkText(update.content))
        case 'tool_call':
        case 'tool_call_update': {
          const id = update.toolCallId
          if (!id) return null
          const part: NormalizedPart = {
            id,
            type: 'tool',
            tool: update.title ?? 'tool',
            args: chunkText(update.content),
            status: mapAcpToolStatus(update.status),
          }
          return { kind: 'part', sessionId, part }
        }
        // available_commands_update et al. are not relay-relevant.
        default:
          return null
      }
    },
    reset(sessionId) {
      const st = turns.get(sessionId)
      if (st) { st.textPartId = undefined; st.reasoningPartId = undefined; st.turn += 1 }
    },
    drop(sessionId) {
      turns.delete(sessionId)
    },
  }
}
