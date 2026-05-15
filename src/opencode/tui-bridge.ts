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
   * Submit a text prompt.
   *
   * Primary path: TUI inject (select-session → clear → append → submit).
   * This routes through the opencode TUI so the conversation is visible in
   * the terminal window, exactly as if the user typed it themselves.
   *
   * Fallback: POST /session/{id}/prompt_async when TUI is not available
   * (e.g. TUI is not running). The bot still works, but the conversation
   * won't appear in the TUI display.
   *
   * Returns the sessionID used.
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

    const tuiOk = await this.tryTuiInject(sessionId, text)
    if (tuiOk) return sessionId

    // TUI not running — fall back to headless API submit
    log.info(`prompt_async fallback to ${sessionId}`)
    return this.submitViaPromptAsync(text, sessionId)
  }

  /**
   * Inject a prompt through the TUI interface:
   *   1. select-session — navigate TUI to the target session
   *   2. clear-prompt   — discard any partial input in the compose box
   *   3. append-prompt  — type the message
   *   4. submit-prompt  — press Enter
   *
   * Returns true on success, false if any step fails (caller falls back).
   */
  private async tryTuiInject(sessionId: string, text: string): Promise<boolean> {
    try {
      // Navigate TUI to the target session so the conversation appears there
      const selectRes = await fetch(`${this.baseUrl}/tui/select-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionID: sessionId }),
      })
      if (!selectRes.ok) {
        log.warn(`tui/select-session HTTP ${selectRes.status}`)
        return false
      }

      // Clear any partial text the user may have been typing
      await fetch(`${this.baseUrl}/tui/clear-prompt`, { method: 'POST' })

      // Type the message into the TUI compose box
      const appendRes = await fetch(`${this.baseUrl}/tui/append-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!appendRes.ok) {
        log.warn(`tui/append-prompt HTTP ${appendRes.status}`)
        return false
      }
      const appended = (await appendRes.json()) as boolean
      if (!appended) {
        log.warn('tui/append-prompt returned false (TUI not ready)')
        return false
      }

      // Submit — equivalent to pressing Enter in the TUI
      const submitRes = await fetch(`${this.baseUrl}/tui/submit-prompt`, { method: 'POST' })
      if (!submitRes.ok) {
        log.warn(`tui/submit-prompt HTTP ${submitRes.status}`)
        // Clean up the appended text so the TUI input box is not left dirty
        await fetch(`${this.baseUrl}/tui/clear-prompt`, { method: 'POST' }).catch(() => {})
        return false
      }

      // Verify a TUI is actually consuming the queue. The /tui/* endpoints
      // return true when the server queues the request, but if no TUI is
      // attached (e.g. user runs `opencode serve` without an attached TUI)
      // nothing dequeues it and the prompt never fires. Poll session status
      // briefly — a real TUI submission flips the session to busy fast.
      const consumed = await this.waitForBusy(sessionId, 1500)
      if (!consumed) {
        log.warn('TUI submitted but session did not go busy — no TUI attached, falling back')
        await fetch(`${this.baseUrl}/tui/clear-prompt`, { method: 'POST' }).catch(() => {})
        return false
      }

      log.info(`TUI inject → ${sessionId}`)
      return true
    } catch (err) {
      log.warn('TUI inject error', (err as Error).message)
      return false
    }
  }

  private async waitForBusy(sessionId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const status = await this.getStatus()
        if (status[sessionId]?.type === 'busy') return true
      } catch {
        // ignore transient errors during status polling
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  }

  private async submitViaPromptAsync(text: string, sessionId: string): Promise<string> {
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
