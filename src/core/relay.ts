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

async function pickSessionFallback(client: OpencodeClient): Promise<string> {
  const res = await client.session.list()
  const sessions = (res.data ?? []) as Array<{ id: string; time?: { created?: number } }>
  if (sessions.length === 0) throw new Error('No opencode sessions found — open TUI first')
  const sorted = [...sessions].sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
  return sorted[0].id
}

export function createRelay(deps: RelayDeps) {
  return async function handleIncoming(msg: IncomingMessage): Promise<void> {
    const tuiSession = deps.state.getTuiSelectedSession()
    const lastSession = deps.state.getLastSessionId()
    const sessionId = tuiSession ?? lastSession ?? await pickSessionFallback(deps.client)
    deps.state.setLastSessionId(sessionId)

    const ac = new AbortController()
    deps.state.setActiveAbort(sessionId, ac)
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    deps.cardBus.publish({ kind: 'thinking', sessionId, showStop: true })
    deps.cardBus.publish({ kind: 'user', sessionId, text: msg.text, ts: Date.now() })

    try {
      if (deps.tuiVisible) {
        try {
          await deps.client.tui.appendPrompt({ body: { text: msg.text } } as any)
        } catch (err) {
          log.warn(`TUI mirror failed: ${(err as Error).message}`)
        }
      }

      const nextAgent = deps.state.getNextAgent()
      const nextModel = deps.state.getNextModel()
      log.info(`submitting to session=${sessionId.slice(-8)}, agent=${nextAgent ?? 'default'}, model=${nextModel ? `${nextModel.providerID}/${nextModel.modelID}` : 'default'}`)

      await submitWithRetry(deps.client, {
        text: msg.text,
        sessionId,
        agent: nextAgent,
        model: nextModel,
        signal: ac.signal,
      })

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
      log.warn('relay error', e.message)
      deps.cardBus.publish({ kind: 'error', sessionId, message: e.message })
    } finally {
      clearTimeout(timer)
      deps.state.setActiveAbort(sessionId, undefined)
    }
  }
}
