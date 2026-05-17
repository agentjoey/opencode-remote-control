import type { EventStream } from '../opencode/event-stream.js'
import type { CardBus } from '../core/card-bus.js'
import type { StructuredCard } from '../core/structured-card.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('push')

export interface PushDeps {
  eventStream: EventStream
  cardBus: CardBus
  testFailuresEnabled?: boolean
  maxPerHour?: number
}

export function startPushNotifications(deps: PushDeps): () => void {
  const hourCap = deps.maxPerHour ?? 10
  const sessionCooldownMs = 5 * 60 * 1000
  const recentPushes: number[] = []
  const lastSessionPush = new Map<string, number>()
  const engagedAt = new Map<string, number>()
  const busySince = new Map<string, number>()

  function canPush(sessionId: string): boolean {
    const now = Date.now()
    while (recentPushes.length && now - recentPushes[0] > 60 * 60 * 1000) recentPushes.shift()
    if (recentPushes.length >= hourCap) return false
    const last = lastSessionPush.get(sessionId) ?? 0
    if (now - last < sessionCooldownMs) return false
    return true
  }

  function recordPush(sessionId: string) {
    const now = Date.now()
    recentPushes.push(now)
    lastSessionPush.set(sessionId, now)
  }

  function recordEngagement(sessionId: string) {
    engagedAt.set(sessionId, Date.now())
  }

  function publish(card: StructuredCard) {
    try { deps.cardBus.publish(card) } catch (err) { log.warn('publish failed', err as Error) }
  }

  const unsub = deps.eventStream.onAny(async (raw) => {
    const e = raw as { type: string; properties?: any }
    const p = e.properties
    const sid =
      (typeof p?.sessionID === 'string' && p.sessionID) ||
      (typeof p?.part?.sessionID === 'string' && p.part.sessionID) ||
      undefined
    if (!sid) return

    recordEngagement(sid)

    if (e.type === 'session.status' && p?.status?.type === 'busy') {
      if (!busySince.has(sid)) busySince.set(sid, Date.now())
    } else if (e.type === 'session.idle' || (e.type === 'session.status' && p?.status?.type === 'idle')) {
      const start = busySince.get(sid)
      busySince.delete(sid)
      if (!start) return
      const duration = Date.now() - start
      const lastEngaged = engagedAt.get(sid) ?? 0
      const engagedRecently = Date.now() - lastEngaged < 60 * 60 * 1000
      if (duration > 60_000 && engagedRecently && canPush(sid)) {
        recordPush(sid)
        publish({
          kind: 'info',
          sessionId: sid,
          title: 'Session finished',
          sections: [{ body: `✅ Session <code>…${sid.slice(-8)}</code> finished (${Math.round(duration/1000)}s)` }],
        })
      }
    }

    if (deps.testFailuresEnabled !== false && e.type === 'message.part.updated') {
      const part = p?.part
      if (part?.type === 'tool' && part.tool === 'bash' && part.state?.output) {
        const tail = (part.state.output as string).slice(-200)
        if (/\b(FAIL|FAILED|error:|✗)\b/.test(tail) && canPush(sid)) {
          recordPush(sid)
          publish({
            kind: 'info',
            sessionId: sid,
            title: 'Test failure detected',
            sections: [
              { body: `⚠️ Possible test failure in <code>…${sid.slice(-8)}</code>` },
              { body: '<pre>' + tail.replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!)) + '</pre>' },
            ],
          })
        }
      }
    }
  })

  return () => { unsub?.() }
}
