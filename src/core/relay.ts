import type { OpencodeClient } from '@opencode-ai/sdk'
import type { CardBus } from './card-bus.js'
import type { IncomingMessage } from './types.js'
import type { SessionState } from './state.js'
import type { EventStream } from '../opencode/event-stream.js'
import type { StructuredCard, ToolCall } from './structured-card.js'
import { submitPrompt } from '../opencode/submit.js'
import { summarizeToolArgs } from './history.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('relay')

export interface RelayDeps {
  cardBus: CardBus
  client: OpencodeClient
  eventStream: EventStream
  state: SessionState
  chatTimeoutMs: number
  tuiVisible: boolean
  /** opencode server base URL — used for raw HTTP calls (e.g. /tui/select-session)
   * that SDK v1 does not yet expose as a typed method. */
  baseUrl: string
}

const SUBMIT_MAX_RETRIES = 5
const SUBMIT_RETRY_BASE_MS = 2000

function isNetworkError(err: Error): boolean {
  const msg = err.message.toLowerCase()
  return msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('socket hang up')
}

async function submitWithRetry(
  client: OpencodeClient,
  opts: { text: string; sessionId: string; agent?: string; model?: { providerID: string; modelID: string }; signal?: AbortSignal },
): Promise<void> {
  for (let i = 0; i < SUBMIT_MAX_RETRIES; i++) {
    try {
      await submitPrompt(client, opts)
      return
    } catch (err) {
      const e = err as Error
      if (opts.signal?.aborted) throw e
      if (i < SUBMIT_MAX_RETRIES - 1 && isNetworkError(e)) {
        const delay = SUBMIT_RETRY_BASE_MS * Math.pow(2, i)
        log.warn(`submit failed (attempt ${i + 1}/${SUBMIT_MAX_RETRIES}), retry in ${delay}ms: ${e.message}`)
        await delayOrAbort(delay, opts.signal)
      } else {
        throw e
      }
    }
  }
}

function delayOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal || signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => { clearTimeout(t); reject(new Error('aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

async function waitForBusySession(eventStream: EventStream, signal: AbortSignal, timeoutMs: number): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    let done = false
    const finish = (sid: string | undefined) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (typeof unsub === 'function') unsub()
      resolve(sid)
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    const unsub = eventStream.onAny((rawEvent) => {
      const e = rawEvent as { type?: string; properties?: any }
      const p = e?.properties
      if (e.type === 'session.status' && p?.status?.type === 'busy') {
        const sid = typeof p?.sessionID === 'string' ? p.sessionID : undefined
        if (sid) finish(sid)
      }
    })
    signal.addEventListener('abort', () => finish(undefined), { once: true })
  })
}

/**
 * Navigate the TUI to a specific session via POST /tui/select-session.
 * SDK v1 does not expose this as a typed method, so use raw fetch.
 * Best-effort: failures (TUI not attached, opencode unreachable) are non-fatal.
 */
async function selectTuiSession(baseUrl: string, sessionID: string, signal?: AbortSignal): Promise<void> {
  try {
    const timeoutSignal = AbortSignal.timeout(2000)
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal
    const res = await fetch(`${baseUrl}/tui/select-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionID }),
      signal: combinedSignal,
    })
    if (!res.ok) {
      log.debug(`tui/select-session HTTP ${res.status}`)
    }
  } catch (err) {
    log.debug(`tui/select-session skipped: ${(err as Error).message}`)
  }
}

async function pickSessionFallback(client: OpencodeClient): Promise<string> {
  const res = await client.session.list()
  const sessions = (res.data ?? []) as Array<{ id: string; time?: { created?: number; updated?: number } }>
  if (sessions.length === 0) throw new Error('No opencode sessions found — open TUI first')
  // Sort by time.updated (most recently active) rather than time.created (newest).
  // The TUI is typically working in the most recently active session, not the newest one.
  const sorted = [...sessions].sort((a, b) =>
    (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0)
  )
  return sorted[0].id
}

export function createRelay(deps: RelayDeps) {
  return async function handleIncoming(msg: IncomingMessage): Promise<void> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    // Placeholder sessionId for the thinking card — will be updated once we know the real session.
    const earlySessionId = deps.state.getPinnedSessionId() ?? deps.state.getLastSessionId() ?? 'pending'
    deps.cardBus.publish({ kind: 'thinking', sessionId: earlySessionId, showStop: true })
    deps.cardBus.publish({ kind: 'user', sessionId: earlySessionId, text: msg.text, ts: Date.now() })

    // Declared outside try so catch/finally can reference it.
    let sessionId: string = earlySessionId
    // Set abort controller early so callers can abort before session is resolved.
    deps.state.setActiveAbort(earlySessionId, ac)

    try {
      const nextAgent = deps.state.getNextAgent()
      const nextModel = deps.state.getNextModel()

      // Strategy 1: Submit via TUI — TUI knows its own current session.
      // Only used when: no override (tui.submitPrompt cannot carry per-message
      // overrides), no pin, AND tuiVisible (user wants TUI to drive routing).
      let resolvedId: string | undefined
      const hasOverrides = !!(nextAgent || nextModel)

      if (!hasOverrides && !deps.state.getPinnedSessionId() && deps.tuiVisible) {
        try {
          await deps.client.tui.appendPrompt({ body: { text: msg.text } } as any)
          await (deps.client.tui as any).submitPrompt()
          log.info('submitted via TUI, waiting for busy session…')
          resolvedId = await waitForBusySession(deps.eventStream, ac.signal, 4000)
          if (resolvedId) {
            log.info(`TUI routed to session=${resolvedId.slice(-8)}`)
          } else {
            log.warn('TUI submit succeeded but no busy event within 4s, falling back')
          }
        } catch (err) {
          log.warn(`TUI submit failed: ${(err as Error).message}, falling back to direct API`)
        }
      }

      // Strategy 2: Direct API submission (pinned > last > most-recently-active fallback).
      // When tuiVisible, first navigate the TUI to this session via /tui/select-session
      // so the conversation appears in the TUI window (the bot drives, TUI mirrors).
      if (!resolvedId) {
        const pinnedSession = deps.state.getPinnedSessionId()
        const lastSession = deps.state.getLastSessionId()
        resolvedId = pinnedSession ?? lastSession ?? await pickSessionFallback(deps.client)
        log.info(`submitting directly to session=${resolvedId.slice(-8)}, agent=${nextAgent ?? 'default'}, model=${nextModel ? `${nextModel.providerID}/${nextModel.modelID}` : 'default'}`)
        if (deps.tuiVisible) {
          await selectTuiSession(deps.baseUrl, resolvedId, ac.signal)
        }
        await submitWithRetry(deps.client, {
          text: msg.text,
          sessionId: resolvedId,
          agent: nextAgent,
          model: nextModel,
          signal: ac.signal,
        })
      }

      sessionId = resolvedId
      deps.state.setLastSessionId(sessionId)
      deps.state.setActiveAbort(sessionId, ac)

      let assistantMessageId: string | undefined
      let streamedText = ''
      const textPartIds = new Set<string>()
      const tools: ToolCall[] = []

      for await (const ev of deps.eventStream.session(sessionId, ac.signal)) {
        const e = ev as { type: string; properties: any }
        const p = e.properties

        log.debug(`SSE event: ${e.type}`, JSON.stringify(p).slice(0, 500))

        if (e.type === 'session.idle') {
          log.info('session idle, breaking')
          break
        }
        if (e.type === 'session.status' && p?.status?.type === 'idle') {
          log.info('session status idle, breaking')
          break
        }
        if (e.type === 'session.error') {
          const err = p?.error
          const msg = err?.data?.message ?? err?.message ?? err?.name ?? 'session error'
          throw new Error(msg)
        }

        if (e.type === 'message.part.updated') {
          const part = p?.part
          if (!part) {
            log.info('message.part.updated with no part')
            continue
          }

          if (!assistantMessageId && typeof part.messageID === 'string') {
            assistantMessageId = part.messageID
            log.info(`assistantMessageId set: ${assistantMessageId}`)
          }

          if (part.type === 'text') {
            const partId = typeof part.id === 'string' ? part.id : undefined
            const isNewPart = partId && !textPartIds.has(partId)

            if (typeof p.delta === 'string') {
              streamedText += p.delta
              log.info(`delta received (${p.delta.length} chars): "${p.delta.slice(0, 50)}..."`)
              if (partId) textPartIds.add(partId)
              deps.cardBus.publish({ kind: 'streaming', sessionId, markdownSrc: streamedText, tools: [...tools] })
            } else if (typeof part.text === 'string' && isNewPart) {
              streamedText = part.text
              textPartIds.add(partId)
              log.info(`full text received (${part.text.length} chars): "${part.text.slice(0, 50)}..."`)
              deps.cardBus.publish({ kind: 'streaming', sessionId, markdownSrc: streamedText, tools: [...tools] })
            } else {
              log.info(`text part ignored - delta: ${typeof p.delta}, text: ${typeof part.text}, isNew: ${isNewPart}`)
            }
          }

          if (part.type === 'tool' && typeof part.tool === 'string') {
            const status = part.state?.status ?? 'running'
            tools.push({
              tool: part.tool,
              args: summarizeToolArgs(part.tool, part.state?.input ?? {}),
              status: status === 'error' ? 'error' : status === 'done' ? 'done' : 'running',
            })
            deps.cardBus.publish({ kind: 'streaming', sessionId, markdownSrc: streamedText, tools: [...tools] })
          }
        }

        if (e.type === 'message.part.delta') {
          if (!assistantMessageId && typeof p?.messageID === 'string') {
            assistantMessageId = p.messageID
          }
          const partId = p?.partID as string | undefined
          const field = p?.field as string | undefined
          const delta = p?.delta as string | undefined
          if (partId && field === 'text' && typeof delta === 'string') {
            streamedText += delta
            deps.cardBus.publish({ kind: 'streaming', sessionId, markdownSrc: streamedText, tools: [...tools] })
          }
        }
      }

      log.info(`SSE stream ended. streamedText length: ${streamedText.length}, assistantMessageId: ${assistantMessageId ?? 'none'}`)

      let final = streamedText
      if (!final && assistantMessageId) {
        try {
          const mres = await deps.client.session.message({ path: { id: sessionId, messageID: assistantMessageId } })
          const m = (mres.data ?? {}) as any
          const parts = m.parts ?? []
          const texts: string[] = []
          for (const part of parts) {
            if (part.type === 'text' && typeof part.text === 'string') {
              texts.push(part.text)
            }
          }
          if (texts.length > 0) final = texts.join('')
        } catch (err) {
          log.info('fallback fetch message failed', (err as Error).message)
        }
      }
      if (!final) final = '(empty response)'

      const meta: { agent?: string; model?: string; cost?: number; tokens?: { input: number; output: number } } = {}
      try {
        const sres = await deps.client.session.get({ path: { id: sessionId } })
        const s = (sres.data ?? {}) as any
        const cost = typeof s.cost === 'number' ? s.cost : undefined
        const tok = s.tokens
        const tin = typeof tok?.input === 'number' ? tok.input : undefined
        const tout = typeof tok?.output === 'number' ? tok.output : undefined
        if (cost !== undefined) {
          deps.state.setSessionCost(sessionId, cost)
          meta.cost = cost
        }
        if (tin !== undefined && tout !== undefined) {
          meta.tokens = { input: tin, output: tout }
        }
        if (s.agent?.name) meta.agent = s.agent.name
        if (typeof s.model === 'string') meta.model = s.model.split('/').pop() ?? s.model
      } catch {
        // meta is optional
      }

      deps.cardBus.publish({ kind: 'assistant', sessionId, markdownSrc: final, tools: [...tools], meta })
    } catch (err) {
      const e = err as Error
      if (ac.signal.aborted) {
        log.info('relay aborted (timeout or user stop) — push will notify on session idle')
      } else {
        log.warn('relay error', e.message)
        deps.cardBus.publish({ kind: 'error', sessionId, message: e.message })
      }
    } finally {
      clearTimeout(timer)
      deps.state.setActiveAbort(sessionId, undefined)
    }
  }
}
