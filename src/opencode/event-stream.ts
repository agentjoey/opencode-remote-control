import { EventEmitter } from 'node:events'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { createLogger } from '../utils/logger.js'

const log = createLogger('event-stream')
const RECONNECT_BASE_MS = 3000
const RECONNECT_MAX_MS = 30000
const MAX_CONSECUTIVE_FAILURES = 15

const HEARTBEAT_GAP_MS = 30_000

export class EventStream {
  private emitter = new EventEmitter()
  private stopped = false
  private consecutiveFailures = 0
  private running = false
  private activeListeners = new Set<string>()
  private statusChecker?: () => Promise<Record<string, { type: string }>>
  private reconnectMs: number
  private heartbeatTimer?: ReturnType<typeof setTimeout>

  constructor(reconnectMs = RECONNECT_BASE_MS) {
    this.reconnectMs = reconnectMs
    // Bot will subscribe many session iterators; raise the cap.
    this.emitter.setMaxListeners(50)
  }

  setStatusChecker(fn: () => Promise<Record<string, { type: string }>>): void {
    this.statusChecker = fn
  }

  reconnectDelay(): number {
    return Math.min(
      this.reconnectMs * Math.pow(2, Math.max(0, this.consecutiveFailures - 1)),
      RECONNECT_MAX_MS,
    )
  }

  private extractSessionID(event: any): string | undefined {
    const p = event?.properties
    if (!p) return undefined
    if (typeof p.sessionID === 'string') return p.sessionID
    if (p.part && typeof p.part.sessionID === 'string') return p.part.sessionID
    if (p.info && typeof p.info.sessionID === 'string') return p.info.sessionID
    return undefined
  }

  start(client: OpencodeClient): void {
    if (this.running || this.stopped) return
    this.running = true

    void (async () => {
      while (!this.stopped) {
        try {
          const { stream } = await client.event.subscribe()
          log.info('SSE connected')
          this.consecutiveFailures = 0

          // After every (re)connect, check if any active session generators are
          // waiting for an idle event that was fired while the SSE was down.
          if (this.statusChecker && this.activeListeners.size > 0) {
            try {
              const status = await this.statusChecker()
              for (const sid of this.activeListeners) {
                if (status[sid]?.type !== 'busy') {
                  log.info(`session ${sid} already idle after SSE reconnect, emitting synthetic idle`)
                  this.emitter.emit(sid, { type: 'session.idle', properties: { sessionID: sid } })
                } else {
                  log.info(`session ${sid} still busy after SSE reconnect, emitting synthetic busy`)
                  this.emitter.emit(sid, { type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } })
                }
              }
            } catch {}
          }

          const abortController = new AbortController()

          // Heartbeat: if no event arrives within HEARTBEAT_GAP_MS, force reconnect.
          const resetHeartbeat = () => {
            if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
            this.heartbeatTimer = setTimeout(() => {
              log.warn('SSE heartbeat timeout, forcing reconnect')
              abortController.abort()
            }, HEARTBEAT_GAP_MS)
          }
          resetHeartbeat()

          const signal = abortController.signal

          for await (const event of stream) {
            if (this.stopped || signal.aborted) break
            resetHeartbeat()
            const sid = this.extractSessionID(event)
            if (sid) this.emitter.emit(sid, event)
            this.emitter.emit('*', event)
          }
          log.warn('SSE stream ended unexpectedly')
        } catch (err) {
          log.warn('SSE connection error', (err as Error).message)
        }

        if (this.stopped) break
        this.consecutiveFailures += 1
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          log.error(`SSE failed ${MAX_CONSECUTIVE_FAILURES} times in a row, exiting`)
          process.exit(1)
        }
        const delay = this.reconnectDelay()
        log.info(`SSE reconnect in ${delay}ms (attempt ${this.consecutiveFailures})`)
        await new Promise((r) => setTimeout(r, delay))
      }

      this.running = false
    })()
  }

  async *session(sessionId: string, signal: AbortSignal): AsyncGenerator<unknown> {
    this.activeListeners.add(sessionId)
    const queue: unknown[] = []
    let wake: (() => void) | null = null

    const handler = (e: unknown) => {
      queue.push(e)
      wake?.()
      wake = null
    }
    this.emitter.on(sessionId, handler)

    const onAbort = () => {
      this.emitter.off(sessionId, handler)
      wake?.()
      wake = null
    }
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      while (true) {
        while (queue.length) yield queue.shift()
        if (signal.aborted) break
        await new Promise<void>((r) => { wake = r })
      }
    } finally {
      this.activeListeners.delete(sessionId)
      this.emitter.off(sessionId, handler)
      signal.removeEventListener('abort', onAbort)
    }
  }

  onAny(handler: (event: unknown) => void): () => void {
    this.emitter.on('*', handler)
    return () => this.emitter.off('*', handler)
  }

  stop(): void {
    this.stopped = true
    this.running = false
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.emitter.removeAllListeners()
  }
}
