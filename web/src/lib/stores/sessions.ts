import { writable } from 'svelte/store'
import type { StructuredCard, SessionSummary } from '../api/types.js'

export const sessionList = writable<SessionSummary[]>([])
export const cardsBySession = writable<Record<string, StructuredCard[]>>({})

export function appendCard(card: StructuredCard) {
  if ('sessionId' in card) {
    const sid = card.sessionId
    cardsBySession.update((map) => {
      const list = map[sid] ?? []
      const last = list[list.length - 1]
      if (last?.kind === 'streaming' && card.kind === 'streaming') {
        list[list.length - 1] = card
      } else if (card.kind === 'assistant' || card.kind === 'error') {
        const trimmed = list.filter((c) => c.kind !== 'thinking' && c.kind !== 'streaming')
        trimmed.push(card)
        map[sid] = trimmed
      } else {
        list.push(card)
        map[sid] = list
      }
      return map
    })
  }
}

export function setHistory(sessionId: string, cards: StructuredCard[]) {
  cardsBySession.update((map) => ({ ...map, [sessionId]: cards }))
}
