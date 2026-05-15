import { EventEmitter } from 'node:events'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { createLogger } from '../utils/logger.js'

const log = createLogger('event-stream')
const RECONNECT_MS = 3000
const MAX_CONSECUTIVE_FAILURES = 10

export class EventStream {
  private emitter = new EventEmitter()
  private stopped = false
  private consecutiveFailures = 0
  private running = false

  constructor() {
    // Bot will subscribe many session iterators; raise the cap.
    this.emitter.setMaxListeners(50)
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
          for await (const event of stream) {
            if (this.stopped) break
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
        await new Promise((r) => setTimeout(r, RECONNECT_MS))
      }

      this.running = false
    })()
  }

  async *session(sessionId: string, signal: AbortSignal): AsyncGenerator<unknown> {
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
    this.emitter.removeAllListeners()
  }
}
