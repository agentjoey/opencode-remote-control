import type { OpencodeClient } from '@opencode-ai/sdk'
import type { CardBus } from './card-bus.js'
import type { IncomingMessage } from './types.js'
import type { SessionState } from './state.js'
import { createStreamAccumulator, type PartInput } from './stream-accumulator.js'
import { submitPrompt } from '../opencode/submit.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('relay')

export interface RelayDeps {
  cardBus: CardBus
  client: OpencodeClient
  state: SessionState
  chatTimeoutMs: number
  tuiVisible: boolean
  /** opencode server base URL — used to navigate the TUI when tuiVisible. */
  baseUrl?: string
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

/**
 * Navigate the TUI to a specific session via POST /tui/select-session.
 * SDK v1 does not expose this as a typed method, so use raw fetch.
 * Best-effort: failures (TUI not attached, opencode unreachable) are non-fatal.
 */
async function selectTuiSession(baseUrl: string | undefined, sessionID: string, signal?: AbortSignal): Promise<void> {
  if (!baseUrl) return
  try {
    const normalized = baseUrl.replace(/\/+$/, '')
    const timeoutSignal = AbortSignal.timeout(2000)
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal
    const res = await fetch(`${normalized}/tui/select-session`, {
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
  const sessions = (res.data ?? []) as Array<{ id: string; parentID?: string; time?: { created?: number; updated?: number } }>
  if (sessions.length === 0) throw new Error('No opencode sessions found — open TUI first')
  // Sort by time.updated (most recently active) rather than time.created (newest).
  // Prefer root sessions (no parentID) over child/subagent sessions to avoid
  // accidentally connecting to a completed subagent session.
  const sorted = [...sessions].sort((a, b) => {
    const aIsChild = !!a.parentID
    const bIsChild = !!b.parentID
    // Root sessions come before child sessions
    if (aIsChild !== bIsChild) return aIsChild ? 1 : -1
    // Within same type, sort by most recent activity
    return (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0)
  })
  return sorted[0].id
}

/** Per-session state for Plugin mode where response comes via handleEvent instead of SSE loop. */
interface PluginSessionCtx {
  sessionId: string
  acc: ReturnType<typeof createStreamAccumulator>
  assistantMessageId?: string
  processedPartIds: Set<string>
  partTextAcc: Map<string, string>
  signal: AbortSignal
  timer: ReturnType<typeof setTimeout>
}

function extractSessionID(raw: { type?: string; properties?: any; [key: string]: any }): string | undefined {
  const p = raw.properties ?? {}
  if (typeof p.sessionID === 'string') return p.sessionID
  if (typeof p.sessionId === 'string') return p.sessionId
  if (p.part && typeof p.part.sessionID === 'string') return p.part.sessionID
  if (p.info && typeof p.info.sessionID === 'string') return p.info.sessionID
  return undefined
}

export function createRelay(deps: RelayDeps) {
  /** Plugin mode: per-session response contexts. Only used when eventStream is undefined. */
  const pluginSessions = new Map<string, PluginSessionCtx>()

  function cleanupPluginSession(sessionId: string) {
    const ctx = pluginSessions.get(sessionId)
    if (ctx) {
      clearTimeout(ctx.timer)
      pluginSessions.delete(sessionId)
    }
  }

  const relay = async function handleIncoming(msg: IncomingMessage): Promise<void> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    let sessionId = deps.state.getPinnedSessionId() ?? deps.state.getLastSessionId() ?? 'pending'
    deps.state.setActiveAbort(sessionId, ac)

    try {
      const nextAgent = deps.state.getNextAgent()
      const nextModel = deps.state.getNextModel()

      const pinnedSession = deps.state.getPinnedSessionId()
      const tuiSession = deps.tuiVisible ? deps.state.getTuiSelectedSession() : undefined
      const lastSession = deps.state.getLastSessionId()
      const resolvedId = pinnedSession ?? tuiSession ?? lastSession ?? await pickSessionFallback(deps.client)
      log.info(`submitting to session=${resolvedId.slice(-8)}, agent=${nextAgent ?? 'default'}, model=${nextModel ? `${nextModel.providerID}/${nextModel.modelID}` : 'default'}`)
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

      sessionId = resolvedId
      deps.state.setLastSessionId(sessionId)
      deps.state.setActiveAbort(sessionId, ac)

      // Publish thinking + user cards now that sessionId is known
      deps.cardBus.publish({ kind: 'thinking', sessionId, showStop: true })
      deps.cardBus.publish({ kind: 'user', sessionId, text: msg.text, ts: Date.now() })

      // The response arrives asynchronously via handleEvent() (opencode plugin
      // event hook). Store per-session context and return; finalization happens
      // on session.idle. Clean up the ctx + abort if this run is cancelled.
      cleanupPluginSession(sessionId)
      const ctx: PluginSessionCtx = {
        sessionId,
        acc: createStreamAccumulator(),
        processedPartIds: new Set(),
        partTextAcc: new Map(),
        signal: ac.signal,
        timer,
      }
      pluginSessions.set(sessionId, ctx)
      ac.signal.addEventListener('abort', () => {
        cleanupPluginSession(sessionId)
        deps.state.setActiveAbort(sessionId, undefined)
      }, { once: true })
      return
    } catch (err) {
      const e = err as Error
      if (ac.signal.aborted) {
        log.info('relay aborted (timeout or user stop) — push will notify on session idle')
      } else {
        log.warn('relay error', e.message)
        deps.cardBus.publish({ kind: 'error', sessionId, message: e.message })
      }
      clearTimeout(timer)
      deps.state.setActiveAbort(sessionId, undefined)
    }
  }

  async function publishAssistantCard(params: {
    sessionId: string
    acc: ReturnType<typeof createStreamAccumulator>
    assistantMessageId?: string
  }): Promise<void> {
    const { sessionId, acc } = params
    let { assistantMessageId } = params

    let blocks = acc.finalize()
    if (blocks.length === 0 && assistantMessageId) {
      try {
        const mres = await deps.client.session.message({ path: { id: sessionId, messageID: assistantMessageId } })
        const m = (mres.data ?? {}) as any
        const parts = m.parts ?? []
        for (const part of parts) {
          if (part.type === 'text' && typeof part.text === 'string') {
            blocks.push({ type: 'text', text: part.text })
          }
          if (part.type === 'tool' && typeof part.tool === 'string') {
            const rawStatus = part.state?.status ?? 'running'
            blocks.push({
              type: 'tool',
              tool: part.tool,
              args: String(part.state?.input?.cmd ?? part.state?.input ?? '').slice(0, 60),
              status: rawStatus === 'error' ? 'error' : rawStatus === 'done' || rawStatus === 'completed' ? 'done' : 'running',
            })
          }
        }
      } catch (err) {
        log.info('fallback fetch message failed', (err as Error).message)
      }
    }

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

    if (blocks.length === 0) blocks = [{ type: 'text', text: '(empty response)' }]

    log.info(`relay: publishing assistant card for ${sessionId}, blocks=${blocks.length}`)
    deps.cardBus.publish({ kind: 'assistant', sessionId, blocks, meta })
    log.info(`relay: assistant card published for ${sessionId}`)
  }

  /**
   * handleEvent — opencode plugin event dispatch.
   * Receives individual events from the opencode plugin event hook and drives
   * streaming/finalization for the in-flight session (message.part.updated,
   * message.part.delta, session.idle, session.error).
   */
  relay.handleEvent = async function handleEvent(raw: { type?: string; properties?: any; [key: string]: any }) {
    const eventType = raw.type
    if (!eventType) return

    const p = raw.properties ?? {}

    {
      const sid = extractSessionID(raw)
      const ctx = sid ? pluginSessions.get(sid) : undefined

      if (eventType === 'message.part.updated') {
        const part = p?.part
        if (part && ctx) {
          if (!ctx.assistantMessageId && typeof part.messageID === 'string') {
            ctx.assistantMessageId = part.messageID
          }

          const partId = typeof part.id === 'string' ? part.id : undefined
          const effectiveId = partId ?? `${part.type ?? 'unknown'}:${JSON.stringify(part.state?.input ?? {}).slice(0, 60)}`

          const isNewPart = partId ? !ctx.processedPartIds.has(partId) : true
          if (partId && isNewPart) ctx.processedPartIds.add(partId)

          const input: PartInput = {
            id: effectiveId,
            type: part.type,
            text: part.text,
            tool: part.tool,
            state: part.state,
          }
          const blocks = ctx.acc.update([input])

          if (part.type === 'text') {
            if (isNewPart && typeof part.text === 'string' && partId) {
              ctx.partTextAcc.set(partId, part.text)
            }
          }

          if (!ctx.signal.aborted) {
            deps.cardBus.publish({ kind: 'streaming', sessionId: ctx.sessionId, blocks })
          }
        }
        return
      }

      if (eventType === 'message.part.delta') {
        if (ctx) {
          const partId = p?.partID as string | undefined
          const field = p?.field as string | undefined
          const delta = p?.delta as string | undefined
          if (partId && field === 'text' && typeof delta === 'string') {
            const prev = ctx.partTextAcc.get(partId) ?? ''
            const fullText = prev + delta
            ctx.partTextAcc.set(partId, fullText)
            if (!ctx.signal.aborted) {
              const blocks = ctx.acc.update([{ id: partId, type: 'text', text: fullText }])
              deps.cardBus.publish({ kind: 'streaming', sessionId: ctx.sessionId, blocks })
            }
          }
          if (!ctx.assistantMessageId && typeof p?.messageID === 'string') {
            ctx.assistantMessageId = p.messageID
          }
        }
        return
      }

      if (eventType === 'session.idle') {
        if (ctx) {
          log.info(`[plugin] session idle: ${ctx.sessionId.slice(-8)}, finalizing`)
          const sid = ctx.sessionId
          const acc = ctx.acc
          const msgId = ctx.assistantMessageId
          // Defer SDK calls to next tick to avoid blocking the event hook
          setTimeout(async () => {
            try {
              await publishAssistantCard({ sessionId: sid, acc, assistantMessageId: msgId })
            } catch (err) {
              log.error(`[plugin] publishAssistantCard failed`, err as Error)
            }
          }, 0)
          cleanupPluginSession(ctx.sessionId)
          deps.state.setActiveAbort(ctx.sessionId, undefined)
        } else if (sid) {
          log.info(`[plugin] session idle (no ctx): ${sid.slice(-8)}`)
          deps.cardBus.publish({ kind: 'status', sessionId: sid, fields: { status: 'idle' } })
        }
        return
      }

      if (eventType === 'session.error') {
        if (ctx) {
          const errMsg = p?.error?.message ?? p?.error ?? p?.message ?? 'session error'
          log.warn(`[plugin] session error: ${String(errMsg)}`)
          deps.cardBus.publish({ kind: 'error', sessionId: ctx.sessionId, message: String(errMsg) })
          cleanupPluginSession(ctx.sessionId)
          deps.state.setActiveAbort(ctx.sessionId, undefined)
        } else {
          const errMsg = p?.error?.message ?? p?.error ?? p?.message ?? 'session error'
          const fallbackSid = sid || 'unknown'
          log.warn(`[plugin] session error (no ctx): ${String(errMsg)}`)
          deps.cardBus.publish({ kind: 'error', sessionId: fallbackSid, message: String(errMsg) })
        }
        return
      }

      // message.updated — debug-trace only; finalization is driven by session.idle
      if (eventType === 'message.updated') {
        const info = p?.info
        if (info?.sessionID && !sid) {
          log.debug(`[plugin] message.updated session=${info.sessionID.slice(-8)}`)
        }
        return
      }
    }
  }

  return relay
}
