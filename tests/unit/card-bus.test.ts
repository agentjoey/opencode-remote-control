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
})
