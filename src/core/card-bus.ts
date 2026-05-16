import type { StructuredCard } from './structured-card.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('card-bus')

const DEFAULT_BUFFER = 100

export interface CardBus {
  publish(card: StructuredCard): void
  subscribe(sessionId: string, fn: (card: StructuredCard) => void): () => void
  subscribeAll(fn: (card: StructuredCard) => void): () => void
  recent(sessionId: string, limit?: number): StructuredCard[]
}

export function createCardBus(bufferSize: number = DEFAULT_BUFFER): CardBus {
  const perSession = new Map<string, Set<(c: StructuredCard) => void>>()
  const all = new Set<(c: StructuredCard) => void>()
  const buffers = new Map<string, StructuredCard[]>()

  function sessionIdOf(c: StructuredCard): string | undefined {
    return 'sessionId' in c ? c.sessionId : undefined
  }

  function safe(fn: (c: StructuredCard) => void, c: StructuredCard) {
    try { fn(c) } catch (err) { log.warn('subscriber error', (err as Error).message) }
  }

  return {
    publish(card) {
      const sid = sessionIdOf(card)
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
  }
}
