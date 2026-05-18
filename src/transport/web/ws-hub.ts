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

  opts.cardBus.subscribeAll((card) => {
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
        state.subscribedSession = msg.sessionId
        // Do NOT replay the cardBus recent buffer. The client already loaded
        // history via GET /api/session/:id; replaying buffered cards causes
        // duplicate inserts and an O(N²) re-render avalanche (100 cards =
        // 5000 Card mounts because each appendCard re-renders the full list).
        // Live cards published after subscribe flow through the regular
        // subscribeAll path.
      }
    },
    detach(ws) { clients.delete(ws) },
    broadcast(card) { /* cards flow via CardBus.publish */ },
  }
}
