import type { StructuredCard } from './structured-card.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('card-bus')

const DEFAULT_BUFFER = 100

export interface CardBus {
  publish(card: StructuredCard): void
  subscribe(sessionId: string, fn: (card: StructuredCard) => void): () => void
  subscribeAll(fn: (card: StructuredCard) => void): () => void
  recent(sessionId: string, limit?: number): StructuredCard[]
  /** Drop the buffer + subscribers for a deleted session (frees memory). */
  drop(sessionId: string): void
}

export function createCardBus(bufferSize: number = DEFAULT_BUFFER): CardBus {
  const perSession = new Map<string, Set<(c: StructuredCard) => void>>()
  const all = new Set<(c: StructuredCard) => void>()
  const buffers = new Map<string, StructuredCard[]>()

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
      log.debug(`cardBus.publish: kind=${card.kind} sessionId=${sid ?? 'none'}, allSubscribers=${all.size}, perSession=${sid ? perSession.get(sid)?.size ?? 0 : 0}`)
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
    drop(sessionId) {
      buffers.delete(sessionId)
      perSession.delete(sessionId)
    },
  }
}
