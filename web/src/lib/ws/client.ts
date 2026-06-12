import { connection, type ConnectionStatus } from '../stores/connection.js'
import { getToken } from '../auth-token.js'

const BACKOFF = [2000, 4000, 8000, 16000, 30000]

// A browser WebSocket can't carry an Authorization header, so token-auth rides
// in the query string (the server reads `?token=` on upgrade). Read it fresh on
// every (re)connect so a token captured after construction still applies.
function withToken(url: string): string {
  const t = getToken()
  if (!t) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(t)}`
}

export interface WsClientOpts {
  url: string
  onMessage?: (msg: any) => void
  onStatus?: (status: ConnectionStatus) => void
  onReconnect?: () => void
}

export interface WsClient {
  send(msg: any): void
  close(): void
}

export function createWsClient(opts: WsClientOpts): WsClient {
  let ws: WebSocket | null = null
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setTimeout> | null = null
  let pongTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  function setStatus(s: ConnectionStatus) {
    connection.set(s)
    opts.onStatus?.(s)
  }

  function clearTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (pingTimer) { clearTimeout(pingTimer); pingTimer = null }
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = null }
  }

  function schedulePing() {
    pingTimer = setTimeout(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
        pongTimer = setTimeout(() => {
          ws?.close()
          reconnect()
        }, 45000)
      }
    }, 25000)
  }

  function connect() {
    if (closed) return
    setStatus('reconnecting')
    try {
      ws = new WebSocket(withToken(opts.url))
    } catch {
      reconnect()
      return
    }

    ws.onopen = () => {
      reconnectAttempt = 0
      setStatus('connected')
      opts.onReconnect?.()
      schedulePing()
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'pong') {
          if (pongTimer) { clearTimeout(pongTimer); pongTimer = null }
          schedulePing()
          return
        }
        opts.onMessage?.(msg)
      } catch {}
    }

    ws.onclose = () => {
      clearTimers()
      if (!closed) reconnect()
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  function reconnect() {
    clearTimers()
    if (closed) return
    setStatus('reconnecting')
    const delay = BACKOFF[Math.min(reconnectAttempt, BACKOFF.length - 1)]
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => void connect(), delay)
  }

  void connect()

  return {
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg))
      }
    },
    close() {
      closed = true
      clearTimers()
      ws?.close()
      ws = null
      setStatus('offline')
    },
  }
}
