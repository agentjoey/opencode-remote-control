/**
 * @deprecated Use inline polling in plugin/entry.ts instead.
 * TUI session synchronization via EventStream — sidecar mode only.
 * Not used in Plugin mode.
 */
import type { EventStream } from '../opencode/event-stream.js'
import type { SessionState } from './state.js'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tui-sync')

interface SyncDeps {
  eventStream: EventStream
  state: SessionState
  client: OpencodeClient
  pollIntervalMs?: number
}

export function startTuiSync(deps: SyncDeps): () => void {
  // Subscribe to events; whenever we see a sessionID in any event,
  // update tuiSelectedSession.
  const unsub = deps.eventStream.onAny((rawEvent) => {
    const e = rawEvent as { type?: string; properties?: any }
    const p = e?.properties
    const sid =
      (typeof p?.sessionID === 'string' && p.sessionID) ||
      (typeof p?.part?.sessionID === 'string' && p.part.sessionID) ||
      (typeof p?.info?.sessionID === 'string' && p.info.sessionID) ||
      undefined
    if (!sid) return
    // Only update tuiSelectedSession from explicit TUI navigation events.
    // Updating from all events (including subagent sessions) caused session
    // mismatch: subagent SSE events would silently redirect the bot to a wrong session.
    if (e.type === 'tui.session.select') {
      deps.state.setTuiSelectedSession(sid)
    }
  })

  // Poll the selected session to refresh current agent
  const poll = deps.pollIntervalMs ?? 5000
  const timer = setInterval(async () => {
    const sid = deps.state.getTuiSelectedSession()
    if (!sid) return
    try {
      const res = await deps.client.session.get({ path: { id: sid } } as any)
      const data = res.data as { agent?: string } | undefined
      if (data?.agent) deps.state.setCurrentAgent(data.agent)
    } catch (err) {
      log.debug('poll session.get failed', (err as Error).message)
    }
  }, poll)

  return () => {
    unsub?.()
    clearInterval(timer)
  }
}
