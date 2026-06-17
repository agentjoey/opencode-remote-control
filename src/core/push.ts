import type { CardBus } from '../core/card-bus.js'
import type { StructuredCard } from '../core/structured-card.js'
import type { SessionState } from '../core/state.js'
import type { OcEvent } from '../core/opencode-events.js'
import type { AgentBackend } from './agent/backend.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('push')

/** Skip the "Session finished" push if the relay delivered the result this recently. */
const RELAY_DELIVERY_DEDUP_MS = 60_000

export interface PushDeps {
  cardBus: CardBus
  backend: AgentBackend
  /** Used to suppress duplicate notifications for sessions the relay just delivered. */
  state?: SessionState
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
      const cards = await deps.backend.getHistory(sid)
      log.info(`fetchSummary: ${cards.length} cards for ${sid.slice(-8)}`)
      const lastAssistant = [...cards].reverse().find((c) => c.kind === 'assistant')
      if (!lastAssistant || lastAssistant.kind !== 'assistant') {
        log.info(`fetchSummary: no assistant card in ${cards.length} cards`)
        return ''
      }
      log.info(`fetchSummary: last assistant has ${lastAssistant.blocks.length} blocks`)
      const texts: string[] = []
      for (const block of lastAssistant.blocks) {
        if (block.type === 'text') texts.push(block.text)
      }
      const combined = texts.join('')
      log.info(`fetchSummary: ${combined.length} chars of text from ${texts.length} text blocks`)
      return combined.length > 300 ? combined.slice(0, 300) + '…' : combined
    } catch (err) {
      log.warn('fetchSummary failed', (err as Error).message)
      return ''
    }
  }

  const handler = async (raw: OcEvent) => {
    const e = raw
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
      // If the relay already delivered this session's result to the user
      // (foreground bot/web message), don't also push a "Session finished" card.
      const deliveredAt = deps.state?.getAssistantDeliveredAt(sid)
      const justDelivered = deliveredAt !== undefined && Date.now() - deliveredAt < RELAY_DELIVERY_DEDUP_MS
      if (duration > 60_000 && engagedRecently && !justDelivered && canPush(sid)) {
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
        publish({ kind: 'info', sessionId: sid, title: 'Session finished', sections, proactive: true })
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
            proactive: true,
          })
        }
      }
    }
  }

  return {
    /** Feed events from the opencode plugin event hook. */
    handleEvent: handler,
    /** No-op retained for symmetry with the plugin lifecycle. */
    stop: () => {},
    /** Lightweight counters for the rc-status diagnostic tool. */
    stats: () => {
      const now = Date.now()
      while (recentPushes.length && now - recentPushes[0] > 60 * 60 * 1000) recentPushes.shift()
      return { pushesLastHour: recentPushes.length, trackedSessions: lastSessionPush.size }
    },
  }
}
