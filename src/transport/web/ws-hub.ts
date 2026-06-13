import type { WebSocket } from 'ws'
import type { CardBus } from '../../core/card-bus.js'
import type { StructuredCard } from '../../core/structured-card.js'
import type { SessionState } from '../../core/state.js'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { fetchSessionSummaries } from './session-summary.js'

interface ClientState {
  ws: WebSocket
  user: { email: string }
  subscribedSession?: string
}

export interface WsHub {
  attach(ws: WebSocket, user: { email: string }): void
  handleClientMessage(ws: WebSocket, msg: any): void
  detach(ws: WebSocket): void
  broadcast(card: StructuredCard): void
}

export function createWsHub(opts: { cardBus: CardBus; client: OpencodeClient; state: SessionState }): WsHub {
  const clients = new Map<WebSocket, ClientState>()

  // Proactive cards (push notifications: test-failure, session-finished) are a
  // Telegram delivery concern. The web shows the full turn live, so rendering a
  // late-arriving notification would just pile up at the feed end out of order.
  // Telegram still gets them via its own CardBus subscription.
  const isProactive = (card: StructuredCard): boolean => 'proactive' in card && card.proactive === true

  opts.cardBus.subscribeAll((card) => {
    if (isProactive(card)) return
    const sid = 'sessionId' in card ? card.sessionId : undefined
    for (const state of clients.values()) {
      if (state.ws.readyState !== 1) continue
      if (sid && state.subscribedSession && state.subscribedSession !== sid) continue
      try { state.ws.send(JSON.stringify({ type: 'card', card })) } catch {}
    }
  })

  return {
    async attach(ws, user) {
      const sessions = await fetchSessionSummaries(opts.client, opts.state).catch(() => [])
      clients.set(ws, { ws, user })
      try { ws.send(JSON.stringify({ type: 'hello', sessions })) } catch {}
    },
    handleClientMessage(ws, msg) {
      const state = clients.get(ws)
      if (!state) return
      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return }
      if (msg.type === 'subscribe' && typeof msg.sessionId === 'string') {
        const sid = msg.sessionId
        state.subscribedSession = sid
        // Replay buffered cards published after the client's snapshot. The
        // client sends sinceSeq = lastSeq from GET /api/session/:id; we replay
        // only cards with a higher seq, so there's no gap and no duplicate
        // (the client also dedupes by seq). Earlier code never replayed, which
        // dropped any card that landed between the REST snapshot and subscribe.
        const since = typeof msg.sinceSeq === 'number' ? msg.sinceSeq : 0
        for (const card of opts.cardBus.recent(sid)) {
          if (isProactive(card)) continue
          if ((card.seq ?? 0) > since && state.ws.readyState === 1) {
            try { state.ws.send(JSON.stringify({ type: 'card', card })) } catch {}
          }
        }
        try { state.ws.send(JSON.stringify({ type: 'replayEnd', sessionId: sid, lastSeq: opts.cardBus.currentSeq(sid) })) } catch {}
      }
    },
    detach(ws) { clients.delete(ws) },
    broadcast(card) { /* cards flow via CardBus.publish */ },
  }
}
