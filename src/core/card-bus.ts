import type { StructuredCard } from './structured-card.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('card-bus')

const DEFAULT_BUFFER = 100

export interface CardBus {
  publish(card: StructuredCard): void
  subscribe(sessionId: string, fn: (card: StructuredCard) => void): () => void
  subscribeAll(fn: (card: StructuredCard) => void): () => void
  recent(sessionId: string, limit?: number): StructuredCard[]
  /** Current max sequence number assigned for a session (0 if none). */
  currentSeq(sessionId: string): number
  /** Drop the buffer + subscribers for a deleted session (frees memory). */
  drop(sessionId: string): void
}

export function createCardBus(bufferSize: number = DEFAULT_BUFFER): CardBus {
  const perSession = new Map<string, Set<(c: StructuredCard) => void>>()
  const all = new Set<(c: StructuredCard) => void>()
  const buffers = new Map<string, StructuredCard[]>()
  const seqCounters = new Map<string, number>()

  function sessionIdOf(c: StructuredCard): string | undefined {
    return 'sessionId' in c ? c.sessionId : undefined
  }

  function safe(fn: (c: StructuredCard) => void, c: StructuredCard) {
    try { fn(c) } catch (err) {
      const sid = 'sessionId' in c ? c.sessionId : undefined
      log.warn('subscriber error', (err as Error).message, { kind: c.kind, sessionId: sid })
    }
  }

  return {
    publish(card) {
      const sid = sessionIdOf(card)
      // Stamp a per-session monotonic seq + a stable id (callers may pre-set id
      // for streaming/assistant so the UI upserts the turn in place).
      if (sid) {
        const next = (seqCounters.get(sid) ?? 0) + 1
        seqCounters.set(sid, next)
        card.seq = next
      }
      if (!card.id) card.id = `${card.kind}:${card.seq ?? Date.now()}`
      log.debug(`cardBus.publish: kind=${card.kind} id=${card.id} seq=${card.seq ?? '-'} sessionId=${sid ?? 'none'}`)
      if (sid) {
        const buf = buffers.get(sid) ?? []
        buf.push(card)
        if (buf.length > bufferSize) buf.shift()
        buffers.set(sid, buf)
        perSession.get(sid)?.forEach((fn) => safe(fn, card))
      }
      all.forEach((fn) => safe(fn, card))
    },
    subscribe(sessionId, fn) {
      let s = perSession.get(sessionId)
      if (!s) { s = new Set(); perSession.set(sessionId, s) }
      s.add(fn)
      return () => { s!.delete(fn) }
    },
    subscribeAll(fn) {
      all.add(fn)
      return () => { all.delete(fn) }
    },
    recent(sessionId, limit = bufferSize) {
      const buf = buffers.get(sessionId) ?? []
      return buf.slice(-limit)
    },
    currentSeq(sessionId) {
      return seqCounters.get(sessionId) ?? 0
    },
    drop(sessionId) {
      buffers.delete(sessionId)
      perSession.delete(sessionId)
      seqCounters.delete(sessionId)
    },
  }
}
