import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startPushNotifications } from '../../src/core/push'
import type { CardBus } from '../../src/core/card-bus'
import type { EventStream } from '../../src/opencode/event-stream'
import type { StructuredCard } from '../../src/core/structured-card'

function fakeEventStream() {
  const listeners: Array<(e: any) => void> = []
  return {
    onAny: vi.fn((fn) => { listeners.push(fn); return () => {} }),
    emit(e: any) { listeners.forEach((fn) => fn(e)) },
  }
}

function fakeCardBus() {
  const published: StructuredCard[] = []
  return {
    published,
    publish: vi.fn((card: StructuredCard) => { published.push(card) }),
    subscribe: vi.fn(),
    subscribeAll: vi.fn(),
    recent: vi.fn().mockReturnValue([]),
  }
}

describe('startPushNotifications', () => {
  let eventStream: ReturnType<typeof fakeEventStream>
  let cardBus: ReturnType<typeof fakeCardBus>
  let stop: () => void

  beforeEach(() => {
    eventStream = fakeEventStream()
    cardBus = fakeCardBus()
    vi.useFakeTimers()
    stop = startPushNotifications({ eventStream: eventStream as any as EventStream, cardBus: cardBus as any as CardBus })
  })

  it('publishes info card after 60s+ session finish', () => {
    const sid = 'ses_test123'
    eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    vi.advanceTimersByTime(70_000)
    eventStream.emit({ type: 'session.idle', properties: { sessionID: sid } })
    expect(cardBus.publish).toHaveBeenCalledTimes(1)
    expect(cardBus.published[0]).toMatchObject({ kind: 'info', sessionId: sid, title: 'Session finished' })
  })

  it('does not publish if session finished under 60s', () => {
    const sid = 'ses_quick'
    eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    vi.advanceTimersByTime(10_000)
    eventStream.emit({ type: 'session.idle', properties: { sessionID: sid } })
    expect(cardBus.publish).not.toHaveBeenCalled()
  })

  it('publishes info card on bash FAIL', () => {
    const sid = 'ses_bash'
    eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    eventStream.emit({
      type: 'message.part.updated',
      properties: { sessionID: sid, part: { type: 'tool', tool: 'bash', state: { output: 'some output FAIL at the end' } } },
    })
    expect(cardBus.publish).toHaveBeenCalledTimes(1)
    expect(cardBus.published[0]).toMatchObject({ kind: 'info', sessionId: sid, title: 'Test failure detected' })
  })

  it('respects rate limit (maxPerHour)', () => {
    const deps = {
      eventStream: fakeEventStream() as any as EventStream,
      cardBus: fakeCardBus() as any as CardBus,
      maxPerHour: 2,
    }
    stop = startPushNotifications(deps)
    for (let i = 0; i < 5; i++) {
      const sid = `ses_rate_${i}`
      deps.eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
      vi.advanceTimersByTime(70_000)
      deps.eventStream.emit({ type: 'session.idle', properties: { sessionID: sid } })
      vi.advanceTimersByTime(10)
    }
    expect(deps.cardBus.publish).toHaveBeenCalledTimes(2)
  })

  it('respects per-session cooldown', () => {
    const sid = 'ses_cool'
    eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    vi.advanceTimersByTime(70_000)
    eventStream.emit({ type: 'session.idle', properties: { sessionID: sid } })
    expect(cardBus.publish).toHaveBeenCalledTimes(1)

    // Repeat immediately — should be suppressed by 5min cooldown
    eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    vi.advanceTimersByTime(70_000)
    eventStream.emit({ type: 'session.idle', properties: { sessionID: sid } })
    expect(cardBus.publish).toHaveBeenCalledTimes(1) // still 1
  })
})
