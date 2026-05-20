import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startPushNotifications } from '../../src/core/push'
import type { CardBus } from '../../src/core/card-bus'
import type { EventStream } from '../../src/opencode/event-stream'
import type { StructuredCard } from '../../src/core/structured-card'
import type { OpencodeClient } from '@opencode-ai/sdk'

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

function fakeClient(lastAssistantText?: string): OpencodeClient {
  return {
    session: {
      messages: vi.fn().mockResolvedValue({
        data: lastAssistantText
          ? [{ role: 'assistant', parts: [{ type: 'text', text: lastAssistantText }] }]
          : [],
      }),
    },
  } as any
}

describe('startPushNotifications', () => {
  let eventStream: ReturnType<typeof fakeEventStream>
  let cardBus: ReturnType<typeof fakeCardBus>
  let stop: () => void

  beforeEach(() => {
    eventStream = fakeEventStream()
    cardBus = fakeCardBus()
    vi.useFakeTimers()
    stop = startPushNotifications({ eventStream: eventStream as any as EventStream, cardBus: cardBus as any as CardBus, client: fakeClient() as any as OpencodeClient })
  })

  it('publishes info card after 60s+ session finish', async () => {
    const sid = 'ses_test123'
    eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    vi.advanceTimersByTime(70_000)
    eventStream.emit({ type: 'session.idle', properties: { sessionID: sid } })
    // Wait for async fetchSummary (including retry delay) to resolve
    await vi.advanceTimersByTimeAsync(3100)
    expect(cardBus.publish).toHaveBeenCalledTimes(1)
    expect(cardBus.published[0]).toMatchObject({ kind: 'info', sessionId: sid, title: 'Session finished' })
  })

  it('does not publish if session finished under 60s', async () => {
    const sid = 'ses_quick'
    eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    vi.advanceTimersByTime(10_000)
    eventStream.emit({ type: 'session.idle', properties: { sessionID: sid } })
    await vi.advanceTimersByTimeAsync(1)
    expect(cardBus.publish).not.toHaveBeenCalled()
  })

  it('publishes info card on bash FAIL', async () => {
    const sid = 'ses_bash'
    eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    eventStream.emit({
      type: 'message.part.updated',
      properties: { sessionID: sid, part: { type: 'tool', tool: 'bash', state: { output: 'some output FAIL at the end' } } },
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(cardBus.publish).toHaveBeenCalledTimes(1)
    expect(cardBus.published[0]).toMatchObject({ kind: 'info', sessionId: sid, title: 'Test failure detected' })
  })

  it('respects rate limit (maxPerHour)', async () => {
    const deps = {
      eventStream: fakeEventStream() as any as EventStream,
      cardBus: fakeCardBus() as any as CardBus,
      client: fakeClient() as any as OpencodeClient,
      maxPerHour: 2,
    }
    stop = startPushNotifications(deps)
    for (let i = 0; i < 5; i++) {
      const sid = `ses_rate_${i}`
      deps.eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
      vi.advanceTimersByTime(70_000)
      deps.eventStream.emit({ type: 'session.idle', properties: { sessionID: sid } })
      await vi.advanceTimersByTimeAsync(3100)
    }
    expect(deps.cardBus.publish).toHaveBeenCalledTimes(2)
  })

  it('respects per-session cooldown', async () => {
    const sid = 'ses_cool'
    eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    vi.advanceTimersByTime(70_000)
    eventStream.emit({ type: 'session.idle', properties: { sessionID: sid } })
    await vi.advanceTimersByTimeAsync(3100)
    expect(cardBus.publish).toHaveBeenCalledTimes(1)
    // Repeat immediately — should be suppressed by 5min cooldown
    eventStream.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    vi.advanceTimersByTime(70_000)
    eventStream.emit({ type: 'session.idle', properties: { sessionID: sid } })
    await vi.advanceTimersByTimeAsync(3100)
    expect(cardBus.publish).toHaveBeenCalledTimes(1) // still 1
  })

  it('includes assistant message summary in session finish notification', async () => {
    const summary = '我们实现了分页修复，在 TelegramSessionRenderer 中添加了 chunkStartOffset 追踪。renderStreaming 现在从 offset 切片 markdownSrc…'
    const client = fakeClient(summary) as any as OpencodeClient
    const es = fakeEventStream()
    const cb = fakeCardBus()
    stop = startPushNotifications({ eventStream: es as any as EventStream, cardBus: cb as any as CardBus, client })

    const sid = 'ses_summary'
    es.emit({ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
    vi.advanceTimersByTime(70_000)
    es.emit({ type: 'session.idle', properties: { sessionID: sid } })
    await vi.advanceTimersByTimeAsync(1)

    expect(cb.publish).toHaveBeenCalledTimes(1)
    const card = cb.published[0]
    expect(card).toMatchObject({ kind: 'info', sessionId: sid, title: 'Session finished' })
    expect(card.sections.length).toBeGreaterThanOrEqual(2)
    expect(card.sections[1].body).toContain('chunkStartOffset')
    expect(card.sections[1].body).toContain('markdownSrc')
  })
})
