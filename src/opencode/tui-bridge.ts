import type { OpencodeClient } from '@opencode-ai/sdk'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tui-bridge')

export type SubmitFailureReason = 'no_session' | 'session_busy' | 'submit_rejected'

export class TuiSubmitError extends Error {
  constructor(public reason: SubmitFailureReason, message: string) {
    super(message)
    this.name = 'TuiSubmitError'
  }
}

interface SessionStatus {
  [sessionId: string]: { type: string }
}

interface SessionListItem {
  id: string
  title?: string
  time?: { created?: number }
}

export class TuiBridge {
  constructor(
    private baseUrl: string,
    private client: OpencodeClient,
  ) {}

  /**
   * Pick the session to submit to. If `forced` is provided, use it.
   * Otherwise, fall back to the newest session in `/session` list
   * (TUI auto-creates a session on open, so newest ≈ TUI's current).
   */
  async pickSession(forced?: string): Promise<string> {
    if (forced) return forced
    const result = await this.client.session.list()
    const sessions = (result.data ?? []) as SessionListItem[]
    if (sessions.length === 0) {
      throw new TuiSubmitError(
        'no_session',
        'No opencode sessions found — open the TUI on your Mac first.',
      )
    }
    const sorted = [...sessions].sort(
      (a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0),
    )
    return sorted[0].id
  }

  async getStatus(): Promise<SessionStatus> {
    const res = await fetch(`${this.baseUrl}/session/status`)
    if (!res.ok) throw new Error(`/session/status HTTP ${res.status}`)
    return (await res.json()) as SessionStatus
  }

  /**
   * Submit a text prompt to a session via `POST /session/{id}/prompt_async`.
   * Returns the sessionID used. If `sessionIdOverride` is null/undefined,
   * picks the newest available session.
   * Throws TuiSubmitError with reason:
   *   - 'no_session'      — no opencode sessions exist
   *   - 'session_busy'    — target session is already generating
   *   - 'submit_rejected' — HTTP error from opencode
   */
  async submit(text: string, sessionIdOverride?: string): Promise<string> {
    const sessionId = await this.pickSession(sessionIdOverride)

    const status = await this.getStatus()
    if (status[sessionId]?.type === 'busy') {
      throw new TuiSubmitError(
        'session_busy',
        `Session ${sessionId} is already generating. Wait for it or /abort.`,
      )
    }

    log.info(`submitting to ${sessionId}`)
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
    })

    if (!res.ok) {
      throw new TuiSubmitError(
        'submit_rejected',
        `POST /session/${sessionId}/prompt_async returned HTTP ${res.status}`,
      )
    }

    return sessionId
  }
}
