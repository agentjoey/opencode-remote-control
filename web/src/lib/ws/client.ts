import { connection, type ConnectionStatus } from '../stores/connection.js'

const BACKOFF = [2000, 4000, 8000, 16000, 30000]

export interface WsClientOpts {
  url: string
  onMessage?: (msg: any) => void
  onStatus?: (status: ConnectionStatus) => void
  onReconnect?: () => void
  /**
   * Optional per-connection auth ticket (B5/A1). When set, a fresh ticket is
   * fetched before each (re)connect and appended as `?ticket=`. Used by the
   * extension, which can't put service-token headers on a WebSocket; the PWA
   * leaves this unset and relies on the CF Access cookie.
   */
  getTicket?: () => Promise<string | null>
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

  async function connect() {
    if (closed) return
    setStatus('reconnecting')
    let url = opts.url
    if (opts.getTicket) {
      try {
        const ticket = await opts.getTicket()
        if (closed) return
        if (ticket) url += (url.includes('?') ? '&' : '?') + 'ticket=' + encodeURIComponent(ticket)
      } catch {
        // fall through and try without a ticket; the server will reject if needed
      }
    }
    try {
      ws = new WebSocket(url)
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
