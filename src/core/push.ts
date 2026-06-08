import type { EventStream } from '../opencode/event-stream.js'
import type { CardBus } from '../core/card-bus.js'
import type { StructuredCard } from '../core/structured-card.js'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { createLogger } from '../utils/logger.js'

const log = createLogger('push')

export interface PushDeps {
  /** EventStream — required for sidecar mode. */
  eventStream?: EventStream
  cardBus: CardBus
  client: OpencodeClient
  testFailuresEnabled?: boolean
  maxPerHour?: number
}

export function startPushNotifications(deps: PushDeps) {
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

  async function fetchSummary(sid: string): Promise<string> {
    try {
      const res = await deps.client.session.messages({ path: { id: sid } })
      const messages = (res.data ?? []) as any[]
      log.info(`fetchSummary: ${messages.length} messages for ${sid.slice(-8)}`)
      const lastAssistant = [...messages].reverse().find((m: any) => m.role === 'assistant')
      if (!lastAssistant) {
        log.info(`fetchSummary: no assistant message in ${messages.length} messages`)
        return ''
      }
      const parts = lastAssistant.parts ?? []
      log.info(`fetchSummary: last assistant has ${parts.length} parts`)
      const texts: string[] = []
      for (const p of parts) {
        if (p.type === 'text' && typeof p.text === 'string') {
          texts.push(p.text)
        }
      }
      const combined = texts.join('')
      log.info(`fetchSummary: ${combined.length} chars of text from ${texts.length} text parts`)
      return combined.length > 300 ? combined.slice(0, 300) + '…' : combined
    } catch (err) {
      log.warn('fetchSummary failed', (err as Error).message)
      return ''
    }
  }

  const handler = async (raw: unknown) => {
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
      const effectiveStart = start ?? engagedAt.get(sid) ?? Date.now()
      const duration = Date.now() - effectiveStart
      const lastEngaged = engagedAt.get(sid) ?? 0
      const engagedRecently = Date.now() - lastEngaged < 12 * 60 * 60 * 1000
      if (duration > 60_000 && engagedRecently && canPush(sid)) {
        recordPush(sid)
        let summary = await fetchSummary(sid)
        if (!summary) {
          log.info(`push: first fetch empty for ${sid.slice(-8)}, retrying in 3s`)
          await new Promise(r => setTimeout(r, 3000))
          summary = await fetchSummary(sid)
        }
        const sections: Array<{ body: string }> = [
          { body: `✅ Session <code>…${sid.slice(-8)}</code> finished (${Math.round(duration/1000)}s)` },
        ]
        if (summary) {
          sections.push({ body: '<pre>' + summary.replace(/[<>&]/g, (c: string) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!)) + '</pre>' })
        }
        publish({ kind: 'info', sessionId: sid, title: 'Session finished', sections })
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
  }

  // Sidecar mode: listen to EventStream
  const unsub = deps.eventStream?.onAny(handler)

  return {
    /** Plugin mode: feed events from the opencode event hook. */
    handleEvent: handler,
    /** Stop the event stream listener (sidecar mode). */
    stop: () => { unsub?.() },
  }
}
