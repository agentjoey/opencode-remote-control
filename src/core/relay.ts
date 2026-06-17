import type { CardBus } from './card-bus.js'
import type { IncomingMessage } from './types.js'
import type { SessionState } from './state.js'
import { createStreamAccumulator, type PartInput } from './stream-accumulator.js'
import { sessionIdOf, errorMessageOf, type OcEvent } from './opencode-events.js'
import type { AgentBackend } from './agent/backend.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('relay')

export interface RelayDeps {
  cardBus: CardBus
  backend: AgentBackend
  state: SessionState
  chatTimeoutMs: number
  /** Whether a local TUI is attached (navigate it to the active session). */
  tuiVisible: boolean
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
  backend: AgentBackend,
  sessionId: string,
  opts: { text: string; agent?: string; model?: { providerID: string; modelID: string }; signal?: AbortSignal },
): Promise<void> {
  for (let i = 0; i < SUBMIT_MAX_RETRIES; i++) {
    try {
      await backend.prompt(sessionId, opts)
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

async function pickSessionFallback(backend: AgentBackend): Promise<string> {
  const sessions = await backend.listSessions()
  if (sessions.length === 0) throw new Error('No opencode sessions found — open TUI first')
  // Prefer root sessions (no parentID) over child/subagent sessions, then most
  // recently active (updatedAt over createdAt) — avoids connecting to a completed
  // subagent session.
  const sorted = [...sessions].sort((a, b) => {
    const aIsChild = !!a.parentID
    const bIsChild = !!b.parentID
    if (aIsChild !== bIsChild) return aIsChild ? 1 : -1
    return (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)
  })
  return sorted[0].id
}

/** Per-session state for Plugin mode where response comes via handleEvent instead of SSE loop. */
interface PluginSessionCtx {
  sessionId: string
  /** Stable card id shared by this turn's streaming updates and final assistant. */
  cardId: string
  acc: ReturnType<typeof createStreamAccumulator>
  assistantMessageId?: string
  processedPartIds: Set<string>
  partTextAcc: Map<string, string>
  signal: AbortSignal
  timer: ReturnType<typeof setTimeout>
}

export function createRelay(deps: RelayDeps) {
  /** Per-session response contexts, keyed by session id. */
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
      // A per-message target (msg.sessionId, set by web to the session the UI is
      // viewing) wins over the global pinned/tui/last fallback, so web and
      // Telegram can drive different sessions at once. Any persisted target may
      // point at a deleted session — validate before submitting, otherwise
      // submitWithRetry burns 5 retries against a 404. A fresh
      // pickSessionFallback() result is trusted as-is.
      let resolvedId = msg.sessionId ?? pinnedSession ?? tuiSession ?? lastSession
      if (resolvedId && !(await deps.backend.hasSession(resolvedId))) {
        log.warn(`target session ${resolvedId.slice(-8)} no longer exists, falling back to newest`)
        resolvedId = undefined
      }
      if (!resolvedId) resolvedId = await pickSessionFallback(deps.backend)
      log.info(`submitting to session=${resolvedId.slice(-8)}, agent=${nextAgent ?? 'default'}, model=${nextModel ? `${nextModel.providerID}/${nextModel.modelID}` : 'default'}`)
      if (deps.tuiVisible) {
        await deps.backend.selectTuiSession?.(resolvedId, ac.signal)
      }
      await submitWithRetry(deps.backend, resolvedId, {
        text: msg.text,
        agent: nextAgent,
        model: nextModel,
        signal: ac.signal,
      })

      sessionId = resolvedId
      deps.state.setLastSessionId(sessionId)
      deps.state.setActiveAbort(sessionId, ac)

      // Publish thinking + user cards now that sessionId is known. The user card
      // id is derived from the incoming messageId so a web client's optimistic
      // user card (same id) reconciles in place instead of duplicating.
      deps.cardBus.publish({ kind: 'thinking', sessionId, showStop: true })
      deps.cardBus.publish({ kind: 'user', sessionId, text: msg.text, ts: Date.now(), id: `user:${msg.messageId}`, origin: msg.origin })

      // The response arrives asynchronously via handleEvent() (opencode plugin
      // event hook). Store per-session context and return; finalization happens
      // on session.idle. Clean up the ctx + abort if this run is cancelled.
      cleanupPluginSession(sessionId)
      const ctx: PluginSessionCtx = {
        sessionId,
        cardId: `turn:${sessionId}:${Date.now()}`,
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
    /** Shared turn id so the final card upserts the streaming card in place. */
    cardId?: string
  }): Promise<void> {
    const { sessionId, acc, cardId } = params
    let { assistantMessageId } = params

    let blocks = acc.finalize()
    if (blocks.length === 0 && assistantMessageId) {
      blocks = await deps.backend.getMessageBlocks(sessionId, assistantMessageId)
    }

    const meta = await deps.backend.getSessionMeta(sessionId)
    if (meta.cost !== undefined) deps.state.setSessionCost(sessionId, meta.cost)

    if (blocks.length === 0) blocks = [{ type: 'text', text: '(empty response)' }]

    log.info(`relay: publishing assistant card for ${sessionId}, blocks=${blocks.length}`)
    deps.cardBus.publish({ kind: 'assistant', sessionId, blocks, meta, id: cardId })
    // Mark delivery so the push engine doesn't also fire a "Session finished"
    // notification for a session the user just watched complete.
    deps.state.markAssistantDelivered(sessionId)
  }

  /**
   * handleEvent — opencode plugin event dispatch.
   * Receives individual events from the opencode plugin event hook and drives
   * streaming/finalization for the in-flight session (message.part.updated,
   * message.part.delta, session.idle, session.error).
   */
  relay.handleEvent = async function handleEvent(raw: OcEvent) {
    const eventType = raw.type
    if (!eventType) return

    const p = raw.properties ?? {}

    {
      const sid = sessionIdOf(raw)
      let ctx = sid ? pluginSessions.get(sid) : undefined

      // Adopt externally-initiated turns: a streaming event arrives for a session
      // we never submitted to (an opencode command run from the palette, or a
      // message typed directly in the TUI), so there's no context — create one
      // so it streams/renders in Web/Telegram like any other turn. The signal
      // never aborts (we don't own this turn); the card's stop button still
      // calls opencode's abort directly.
      if (!ctx && sid && (eventType === 'message.part.updated' || eventType === 'message.part.delta')) {
        ctx = {
          sessionId: sid,
          cardId: `turn:${sid}:${Date.now()}`,
          acc: createStreamAccumulator(),
          processedPartIds: new Set(),
          partTextAcc: new Map(),
          signal: new AbortController().signal,
          timer: setTimeout(() => {}, deps.chatTimeoutMs),
        }
        pluginSessions.set(sid, ctx)
      }

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
            type: part.type ?? 'unknown',
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
            deps.cardBus.publish({ kind: 'streaming', sessionId: ctx.sessionId, blocks, id: ctx.cardId })
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
              deps.cardBus.publish({ kind: 'streaming', sessionId: ctx.sessionId, blocks, id: ctx.cardId })
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
          // Capture acc/msgId locally: cleanupPluginSession() runs synchronously
          // below, and a new message for the same session would install a fresh
          // ctx with a fresh accumulator — so this deferred finalize must read
          // the snapshot it captured, not pluginSessions.get(sid).
          const sid = ctx.sessionId
          const acc = ctx.acc
          const msgId = ctx.assistantMessageId
          const cardId = ctx.cardId
          // Defer SDK calls to next tick to avoid blocking the event hook
          setTimeout(async () => {
            try {
              await publishAssistantCard({ sessionId: sid, acc, assistantMessageId: msgId, cardId })
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
          const errMsg = errorMessageOf(p)
          log.warn(`[plugin] session error: ${errMsg}`)
          deps.cardBus.publish({ kind: 'error', sessionId: ctx.sessionId, message: errMsg })
          cleanupPluginSession(ctx.sessionId)
          deps.state.setActiveAbort(ctx.sessionId, undefined)
        } else {
          const errMsg = errorMessageOf(p)
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
