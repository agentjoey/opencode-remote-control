import { writable } from 'svelte/store'
import type { StructuredCard, SessionSummary } from '../api/types.js'

export const sessionList = writable<SessionSummary[]>([])

/**
 * Normalized per-session feed. Cards are keyed by their stable `id` (stamped by
 * the backend CardBus): streaming updates and the final assistant card of one
 * turn share an id, so they upsert in place instead of appending. `lastSeq` is
 * the highest per-session sequence applied — used to dedupe replayed cards on
 * reconnect (see B3 / sequence cursor).
 */
export interface SessionFeed {
  order: string[]
  byId: Record<string, StructuredCard>
  lastSeq: number
}

const emptyFeed = (): SessionFeed => ({ order: [], byId: {}, lastSeq: 0 })

export const feeds = writable<Record<string, SessionFeed>>({})

function cardId(card: StructuredCard, fallbackIndex: number): string {
  return card.id ?? `${card.kind}:${card.seq ?? fallbackIndex}`
}

function isTransient(kind: string | undefined): boolean {
  return kind === 'thinking' || kind === 'think-stream'
}

/** Materialize a feed into an ordered card array (for rendering). */
export function cardsOf(feed: SessionFeed | undefined): StructuredCard[] {
  if (!feed) return []
  return feed.order.map((id) => feed.byId[id]).filter(Boolean)
}

/** Apply a live card: upsert by id, dedupe by seq, clear transient thinking. */
export function upsertCard(card: StructuredCard) {
  if (!('sessionId' in card) || !card.sessionId) return
  const sid = card.sessionId
  const id = cardId(card, 0)
  feeds.update((map) => {
    const feed = map[sid] ?? emptyFeed()
    // Already processed up to lastSeq (history snapshot or earlier replay).
    if (card.seq != null && card.seq <= feed.lastSeq && !(id in feed.byId)) return map
    if (card.seq != null) feed.lastSeq = Math.max(feed.lastSeq, card.seq)

    if (id in feed.byId) {
      // upsert in place — streaming → final assistant, same turn id
      feed.byId = { ...feed.byId, [id]: card }
    } else {
      let order = feed.order
      let byId = feed.byId
      // A new turn's first streaming/assistant/error retires transient thinking.
      if (card.kind === 'streaming' || card.kind === 'assistant' || card.kind === 'error') {
        byId = { ...byId }
        order = order.filter((x) => {
          if (isTransient(byId[x]?.kind)) { delete byId[x]; return false }
          return true
        })
      }
      feed.order = [...order, id]
      feed.byId = { ...byId, [id]: card }
    }
    return { ...map, [sid]: feed }
  })
}

/** Replace a session's feed with historical cards (REST snapshot). */
export function setHistory(sessionId: string, cards: StructuredCard[], lastSeq = 0) {
  feeds.update((map) => {
    const feed = emptyFeed()
    feed.lastSeq = lastSeq
    cards.forEach((c, i) => {
      const id = cardId(c, i)
      feed.order.push(id)
      feed.byId[id] = c
    })
    return { ...map, [sessionId]: feed }
  })
}
