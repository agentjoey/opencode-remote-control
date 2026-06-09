import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { feeds, upsertCard, setHistory, cardsOf } from './sessions.js'
import type { StructuredCard } from '../api/types.js'

function feed(sid: string) {
  return get(feeds)[sid]
}

describe('session feed store', () => {
  beforeEach(() => { feeds.set({}) })

  it('appends distinct cards in order', () => {
    upsertCard({ kind: 'user', sessionId: 's', text: 'hi', ts: 1, id: 'u1', seq: 1 })
    upsertCard({ kind: 'assistant', sessionId: 's', blocks: [{ type: 'text', text: 'yo' }], meta: {}, id: 'a1', seq: 2 })
    const cards = cardsOf(feed('s'))
    expect(cards.map((c) => c.kind)).toEqual(['user', 'assistant'])
  })

  it('upserts a streaming card in place by shared id, then the final assistant', () => {
    upsertCard({ kind: 'streaming', sessionId: 's', blocks: [{ type: 'text', text: 'a' }], id: 'turn:1', seq: 1 })
    upsertCard({ kind: 'streaming', sessionId: 's', blocks: [{ type: 'text', text: 'ab' }], id: 'turn:1', seq: 2 })
    upsertCard({ kind: 'assistant', sessionId: 's', blocks: [{ type: 'text', text: 'abc' }], meta: {}, id: 'turn:1', seq: 3 })
    const cards = cardsOf(feed('s'))
    expect(cards).toHaveLength(1)
    expect(cards[0].kind).toBe('assistant')
    expect((cards[0] as any).blocks[0].text).toBe('abc')
    expect(feed('s').lastSeq).toBe(3)
  })

  it('retires a transient thinking card when the turn starts streaming', () => {
    upsertCard({ kind: 'thinking', sessionId: 's', showStop: true, id: 'thinking:1', seq: 1 })
    upsertCard({ kind: 'user', sessionId: 's', text: 'go', ts: 0, id: 'u:2', seq: 2 })
    upsertCard({ kind: 'streaming', sessionId: 's', blocks: [{ type: 'text', text: 'x' }], id: 'turn:1', seq: 3 })
    const kinds = cardsOf(feed('s')).map((c) => c.kind)
    expect(kinds).toEqual(['user', 'streaming'])
  })

  it('ignores a replayed card whose seq is at or below lastSeq', () => {
    setHistory('s', [{ kind: 'user', sessionId: 's', text: 'old', ts: 0, id: 'u:old' } as StructuredCard], 5)
    upsertCard({ kind: 'assistant', sessionId: 's', blocks: [], meta: {}, id: 'a:replay', seq: 4 })
    expect(cardsOf(feed('s')).some((c) => c.id === 'a:replay')).toBe(false)
    upsertCard({ kind: 'assistant', sessionId: 's', blocks: [], meta: {}, id: 'a:new', seq: 6 })
    expect(cardsOf(feed('s')).some((c) => c.id === 'a:new')).toBe(true)
  })

  it('setHistory replaces the feed and sets lastSeq', () => {
    upsertCard({ kind: 'user', sessionId: 's', text: 'stale', ts: 0, id: 'x', seq: 1 })
    setHistory('s', [{ kind: 'user', sessionId: 's', text: 'h', ts: 0, id: 'h1' } as StructuredCard], 10)
    expect(cardsOf(feed('s')).map((c) => c.id)).toEqual(['h1'])
    expect(feed('s').lastSeq).toBe(10)
  })
})
