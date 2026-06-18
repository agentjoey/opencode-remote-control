/**
 * Map opencode plugin events → the normalized AgentEvent the relay consumes.
 * This is the opencode side of the Phase 2 event seam: the relay no longer reads
 * opencode-shaped events directly; an AcpBackend will provide its own
 * session/update → AgentEvent normalizer. See docs/ACP_BACKEND_DESIGN.md.
 */
import type { OcEvent, OcPart } from '../opencode-events.js'
import { sessionIdOf, errorMessageOf } from '../opencode-events.js'
import type { AgentEvent, NormalizedPart } from './event.js'

/** One-line tool-arg summary (was inside stream-accumulator; opencode-specific). */
function summarizeArgs(tool: string, input?: Record<string, unknown>): string {
  if (!input) return ''
  if (tool === 'bash' && typeof input.cmd === 'string') {
    return input.cmd.length > 60 ? input.cmd.slice(0, 57) + '...' : input.cmd
  }
  const keys = Object.keys(input)
  if (keys.length === 0) return ''
  const first = String(input[keys[0]])
  return first.length > 60 ? first.slice(0, 57) + '...' : first
}

function mapToolStatus(s?: string): 'running' | 'done' | 'error' {
  return s === 'error' ? 'error' : s === 'done' || s === 'completed' ? 'done' : 'running'
}

function normalizePart(part: OcPart | undefined): NormalizedPart | null {
  if (!part) return null
  // Opencode parts carry an id; synthesize a stable one when missing so the
  // accumulator can still key it (matches the relay's previous effectiveId).
  const id = typeof part.id === 'string'
    ? part.id
    : `${part.type ?? 'unknown'}:${JSON.stringify(part.state?.input ?? {}).slice(0, 60)}`
  if (part.type === 'text') return { id, type: 'text', text: part.text }
  if (part.type === 'reasoning') return { id, type: 'reasoning', text: part.text }
  if (part.type === 'tool' && typeof part.tool === 'string') {
    return { id, type: 'tool', tool: part.tool, args: summarizeArgs(part.tool, part.state?.input), status: mapToolStatus(part.state?.status) }
  }
  return null
}

/** Normalize one opencode event, or null when it's not relevant to the relay. */
export function normalizeOpencodeEvent(ev: OcEvent): AgentEvent | null {
  const type = ev.type
  if (!type) return null
  const p = ev.properties ?? {}
  const sessionId = sessionIdOf(ev)

  if (type === 'message.part.updated') {
    if (!sessionId) return null
    const part = normalizePart(p.part)
    if (!part) return null
    return { kind: 'part', sessionId, messageId: p.part?.messageID, part }
  }
  if (type === 'message.part.delta') {
    if (!sessionId) return null
    const partId = typeof p.partID === 'string' ? p.partID : undefined
    if (!partId || p.field !== 'text' || typeof p.delta !== 'string') return null
    return { kind: 'delta', sessionId, messageId: typeof p.messageID === 'string' ? p.messageID : undefined, partId, text: p.delta }
  }
  if (type === 'session.idle') {
    if (!sessionId) return null
    return { kind: 'idle', sessionId }
  }
  if (type === 'session.error') {
    return { kind: 'error', sessionId: sessionId ?? 'unknown', message: errorMessageOf(p) }
  }
  // message.updated and everything else are not relay-relevant.
  return null
}
