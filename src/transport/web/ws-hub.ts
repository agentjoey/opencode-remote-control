import type { WebSocket } from 'ws'
import type { CardBus } from '../../core/card-bus.js'
import type { StructuredCard } from '../../core/structured-card.js'

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

export function createWsHub(opts: { cardBus: CardBus }): WsHub {
  const clients = new Map<WebSocket, ClientState>()
  opts.cardBus.subscribeAll((card) => {
    const sid = 'sessionId' in card ? card.sessionId : undefined
    for (const state of clients.values()) {
      if (state.ws.readyState !== 1) continue
      if (sid && state.subscribedSession && state.subscribedSession !== sid) continue
      try { state.ws.send(JSON.stringify({ type: 'card', card })) } catch {}
    }
  })

  return {
    attach(ws, user) {
      clients.set(ws, { ws, user })
      try { ws.send(JSON.stringify({ type: 'hello', sessions: [] })) } catch {}
    },
    handleClientMessage(ws, msg) {
      const state = clients.get(ws)
      if (!state) return
      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return }
      if (msg.type === 'subscribe' && typeof msg.sessionId === 'string') {
        state.subscribedSession = msg.sessionId
        for (const c of opts.cardBus.recent(msg.sessionId, msg.limit ?? 100)) {
          try { ws.send(JSON.stringify({ type: 'card', card: c })) } catch {}
        }
      }
    },
    detach(ws) { clients.delete(ws) },
    broadcast(card) { /* cards flow via CardBus.publish */ },
  }
}
