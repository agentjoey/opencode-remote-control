import { createLogger } from '../utils/logger.js'

const log = createLogger('tui-bridge')

export type SubmitFailureReason = 'tui_not_running' | 'tui_busy' | 'submit_rejected'

export class TuiSubmitError extends Error {
  constructor(public reason: SubmitFailureReason, message: string) {
    super(message)
    this.name = 'TuiSubmitError'
  }
}

interface SubmitOptions {
  deadlineMs?: number
  intervalMs?: number
}

interface SessionStatus {
  [sessionId: string]: { type: string }
}

export class TuiBridge {
  constructor(private baseUrl: string) {}

  private async getStatus(): Promise<SessionStatus> {
    const res = await fetch(`${this.baseUrl}/session/status`)
    if (!res.ok) throw new Error(`/session/status HTTP ${res.status}`)
    return (await res.json()) as SessionStatus
  }

  async submit(text: string, opts: SubmitOptions = {}): Promise<string> {
    const deadlineMs = opts.deadlineMs ?? 5000
    const intervalMs = opts.intervalMs ?? 100

    // 1. Snapshot busy sessions BEFORE submit
    const beforeStatus = await this.getStatus()
    const before = new Set(
      Object.entries(beforeStatus)
        .filter(([, s]) => s.type === 'busy')
        .map(([id]) => id),
    )
    log.debug(`busy before submit: ${[...before].join(',') || '(none)'}`)

    // 2. POST /tui/append-prompt to type text into TUI buffer
    const appendRes = await fetch(`${this.baseUrl}/tui/append-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!appendRes.ok) {
      throw new TuiSubmitError('submit_rejected', `/tui/append-prompt HTTP ${appendRes.status}`)
    }
    const appendBody = await appendRes.json()
    if (appendBody !== true) {
      throw new TuiSubmitError('submit_rejected', `/tui/append-prompt rejected: returned ${JSON.stringify(appendBody)}, expected true`)
    }

    // 3. POST /tui/submit-prompt to press Enter (no body)
    const submitRes = await fetch(`${this.baseUrl}/tui/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!submitRes.ok) {
      throw new TuiSubmitError('submit_rejected', `/tui/submit-prompt HTTP ${submitRes.status}`)
    }
    const okBody = await submitRes.json()
    if (okBody !== true) {
      throw new TuiSubmitError('submit_rejected', `/tui/submit-prompt rejected: returned ${JSON.stringify(okBody)}, expected true`)
    }

    // 3. Poll /session/status for a NEWLY busy session
    const deadline = Date.now() + deadlineMs
    while (Date.now() < deadline) {
      const status = await this.getStatus()
      for (const [sid, s] of Object.entries(status)) {
        if (s.type === 'busy' && !before.has(sid)) {
          log.info(`captured session ${sid}`)
          return sid
        }
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }

    // 4. Differentiate: TUI not running vs TUI busy
    if (before.size === 0) {
      throw new TuiSubmitError(
        'tui_not_running',
        `No session went busy within ${deadlineMs}ms — is the opencode TUI running?`,
      )
    }
    throw new TuiSubmitError(
      'tui_busy',
      `TUI was already busy on session(s) ${[...before].join(',')}; new prompt was queued or ignored.`,
    )
  }
}
