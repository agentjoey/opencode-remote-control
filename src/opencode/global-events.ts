import type { OpencodeClient } from '@opencode-ai/sdk'
import type { OcEvent } from '../core/opencode-events.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('global-events')

export interface GlobalEventsOptions {
  client: OpencodeClient
  /**
   * Called for every opencode event across all workspaces. `directory` is the
   * originating workspace (undefined for server-level meta events).
   */
  onEvent: (event: OcEvent, directory: string | undefined) => void
  /** Exponential-backoff base for reconnects (ms). Default 1000. */
  retryBaseMs?: number
}

export interface GlobalEventsHandle {
  stop(): void
}

/**
 * Subscribe to opencode's cross-workspace event stream (`GET /global/event`)
 * and forward each event. opencode loads the plugin per-workspace, so a
 * per-instance `event` hook only sees its own directory — the global stream is
 * the only way for the PRIMARY instance to observe every workspace. Reconnects
 * with exponential backoff (capped 30s) until stop() is called.
 */
export function startGlobalEvents(opts: GlobalEventsOptions): GlobalEventsHandle {
  let stopped = false
  const retryBase = opts.retryBaseMs ?? 1000

  async function run(): Promise<void> {
    let attempt = 0
    while (!stopped) {
      try {
        const res = await opts.client.global.event()
        attempt = 0
        log.info('global event stream connected')
        const stream = res.stream as AsyncIterable<{ directory?: string; payload: OcEvent }>
        for await (const item of stream) {
          if (stopped) break
          if (item?.payload) opts.onEvent(item.payload, item.directory)
        }
        if (stopped) break
        log.warn('global event stream ended, reconnecting')
      } catch (err) {
        if (stopped) break
        log.warn(`global event stream error: ${(err as Error).message}`)
      }
      const delay = Math.min(retryBase * 2 ** attempt, 30000)
      attempt++
      await new Promise((r) => setTimeout(r, delay))
    }
    log.info('global event stream stopped')
  }

  void run()
  return { stop() { stopped = true } }
}
