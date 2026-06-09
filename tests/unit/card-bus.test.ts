import { describe, it, expect, vi } from 'vitest'
import { createCardBus } from '../../src/core/card-bus'
import type { StructuredCard } from '../../src/core/structured-card'

const card = (sessionId: string, kind: 'thinking' | 'error' = 'thinking'): StructuredCard =>
  kind === 'thinking'
    ? { kind: 'thinking', sessionId, showStop: false }
    : { kind: 'error', sessionId, message: 'x' }

describe('CardBus', () => {
  it('delivers cards to subscribers of matching sessionId', () => {
    const bus = createCardBus()
    const fn = vi.fn()
    bus.subscribe('ses_1', fn)
    bus.publish(card('ses_1'))
    bus.publish(card('ses_2'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('subscribeAll receives every card', () => {
    const bus = createCardBus()
    const fn = vi.fn()
    bus.subscribeAll(fn)
    bus.publish(card('ses_1'))
    bus.publish(card('ses_2'))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('unsubscribe stops delivery', () => {
    const bus = createCardBus()
    const fn = vi.fn()
    const unsub = bus.subscribe('ses_1', fn)
    bus.publish(card('ses_1'))
    unsub()
    bus.publish(card('ses_1'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('recent returns last N cards for session, newest last', () => {
    const bus = createCardBus()
    for (let i = 0; i < 5; i++) bus.publish(card('ses_1'))
    expect(bus.recent('ses_1', 3).length).toBe(3)
  })

  it('isolates subscriber errors', () => {
    const bus = createCardBus()
    const good = vi.fn()
    bus.subscribe('ses_1', () => { throw new Error('boom') })
    bus.subscribe('ses_1', good)
    bus.publish(card('ses_1'))
    expect(good).toHaveBeenCalledTimes(1)
  })

  it('stamps monotonic seq and an id per session', () => {
    const bus = createCardBus()
    const c1 = card('ses_1'); const c2 = card('ses_1'); const c3 = card('ses_2')
    bus.publish(c1); bus.publish(c2); bus.publish(c3)
    expect(c1.seq).toBe(1)
    expect(c2.seq).toBe(2)
    expect(c3.seq).toBe(1) // independent per session
    expect(c1.id).toBeTruthy()
    expect(c1.id).not.toBe(c2.id)
    expect(bus.currentSeq('ses_1')).toBe(2)
    expect(bus.currentSeq('ses_2')).toBe(1)
  })

  it('preserves a caller-supplied id (streaming/assistant share a turn id)', () => {
    const bus = createCardBus()
    const a: StructuredCard = { kind: 'streaming', sessionId: 'ses_1', blocks: [], id: 'turn:x' }
    const b: StructuredCard = { kind: 'assistant', sessionId: 'ses_1', blocks: [], meta: {}, id: 'turn:x' }
    bus.publish(a); bus.publish(b)
    expect(a.id).toBe('turn:x')
    expect(b.id).toBe('turn:x')
    expect(a.seq).toBe(1)
    expect(b.seq).toBe(2) // same id, distinct seq
  })

  it('drop resets the seq counter and buffer', () => {
    const bus = createCardBus()
    bus.publish(card('ses_1'))
    bus.drop('ses_1')
    expect(bus.currentSeq('ses_1')).toBe(0)
    expect(bus.recent('ses_1').length).toBe(0)
  })
})
