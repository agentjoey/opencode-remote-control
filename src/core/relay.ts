import type { OpencodeClient } from '@opencode-ai/sdk'
import type { Transport } from '../transport/interface.js'
import type { Card, IncomingMessage } from './types.js'
import type { SessionState } from './state.js'
import type { EventStream } from '../opencode/event-stream.js'
import { submitPrompt } from '../opencode/submit.js'
import { markdownToTelegramHtml } from '../utils/markdown.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('relay')

export interface RelayDeps {
  transport: Transport
  client: OpencodeClient
  eventStream: EventStream
  state: SessionState
  editThrottleMs: number
  chatTimeoutMs: number
  tuiVisible: boolean
  toolCallsInline?: boolean
}

function thinkingCard(sessionId: string, showStop: boolean): Card {
  const card: Card = { lines: ['⏳  Working…'] }
  if (showStop) {
    card.buttons = [[{ label: '⏹ Stop', data: `relay:abort:${sessionId}` }]]
  }
  return card
}

function errorCard(msg: string): Card {
  const escaped = msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return { lines: [`❌  <b>Error</b>\n\n<code>${escaped}</code>`], rawHtml: true }
}

/** Plain text card used during streaming (no markdown conversion). */
function streamCard(text: string): Card {
  return { lines: [text] }
}

/** Final card: convert markdown to Telegram HTML. */
function finalCard(text: string): Card {
  return { lines: [markdownToTelegramHtml(text)], rawHtml: true }
}

function summarizeToolArgs(tool: string, input: any): string {
  if (tool === 'bash') return (input.command ?? '').slice(0, 60)
  if (tool === 'read' || tool === 'edit' || tool === 'write') return input.filePath ?? ''
  if (tool === 'grep' || tool === 'find') return input.pattern ?? input.query ?? ''
  return ''
}

const MAX_TOOL_LINES = 30
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
    // Prefer TUI-selected session so bot messages go into the active TUI thread.
    const tuiSession = deps.state.getTuiSelectedSession()
    const lastSession = deps.state.getLastSessionId()
    const sessionId = tuiSession ?? lastSession ?? await pickSessionFallback(deps.client)
    deps.state.setLastSessionId(sessionId)

    const ac = new AbortController()
    deps.state.setActiveAbort(sessionId, ac)
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    const initial = await deps.transport.send(
      msg.chatId,
      thinkingCard(sessionId, deps.transport.capabilities.buttons)
    )

    try {

      // Optional TUI mirror (display only)
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

      // SDK-native submission with overrides (with retry for network errors)
      await submitWithRetry(deps.client, {
        text: msg.text,
        sessionId,
        agent: nextAgent,
        model: nextModel,
        signal: ac.signal,
      })

      // Iterate SSE for streaming output
      let assistantMessageId: string | undefined
      let streamedText = ''
      const textPartIds = new Set<string>()
      let lastEdit = 0
      const toolEvents: string[] = []
      const showTools = deps.toolCallsInline !== false

      for await (const ev of deps.eventStream.session(sessionId, ac.signal)) {
        const e = ev as { type: string; properties: any }
        const p = e.properties

        // Debug: log all event types
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

          // Track assistant message ID
          if (!assistantMessageId && typeof part.messageID === 'string') {
            assistantMessageId = part.messageID
            log.info(`assistantMessageId set: ${assistantMessageId}`)
          }

          // Handle text parts
          if (part.type === 'text') {
            const partId = typeof part.id === 'string' ? part.id : undefined
            const isNewPart = partId && !textPartIds.has(partId)
            
            // Apply delta if present
            if (typeof p.delta === 'string') {
              streamedText += p.delta
              log.info(`delta received (${p.delta.length} chars): "${p.delta.slice(0, 50)}..."`)
              if (partId) textPartIds.add(partId)
              const now = Date.now()
              if (deps.transport.capabilities.edit && now - lastEdit >= deps.editThrottleMs) {
                await deps.transport.edit(msg.chatId, initial.messageId, streamCard(streamedText))
                lastEdit = now
              }
            } else if (typeof part.text === 'string' && isNewPart) {
              // Fallback: if no delta but text is present for a new part, use the full text
              streamedText = part.text
              textPartIds.add(partId)
              log.info(`full text received (${part.text.length} chars): "${part.text.slice(0, 50)}..."`)
              const now = Date.now()
              if (deps.transport.capabilities.edit && now - lastEdit >= deps.editThrottleMs) {
                await deps.transport.edit(msg.chatId, initial.messageId, streamCard(streamedText))
                lastEdit = now
              }
            } else {
              log.info(`text part ignored - delta: ${typeof p.delta}, text: ${typeof part.text}, isNew: ${isNewPart}`)
            }
          }

          // Handle tool parts
          if (showTools && part.type === 'tool' && typeof part.tool === 'string') {
            const tool = part.tool
            const input = part.state?.input ?? {}
            const arg = summarizeToolArgs(tool, input)
            const line = `▸ ${tool}${arg ? ` · ${arg}` : ''}`
            if (toolEvents.length === MAX_TOOL_LINES + 1) {
              // suppress further lines
            } else if (toolEvents.length === MAX_TOOL_LINES) {
              toolEvents.push('…more tool calls suppressed')
              streamedText += '\n…more tool calls suppressed'
            } else {
              toolEvents.push(line)
              streamedText += (streamedText ? '\n' : '') + line
              const now = Date.now()
              if (deps.transport.capabilities.edit && now - lastEdit >= deps.editThrottleMs) {
                await deps.transport.edit(msg.chatId, initial.messageId, streamCard(streamedText))
                lastEdit = now
              }
            }
          }
        }

        // Handle text streaming deltas (flat properties: partID, field, delta)
        if (e.type === 'message.part.delta') {
          if (!assistantMessageId && typeof p?.messageID === 'string') {
            assistantMessageId = p.messageID
          }
          const partId = p?.partID as string | undefined
          const field = p?.field as string | undefined
          const delta = p?.delta as string | undefined
          if (partId && field === 'text' && typeof delta === 'string') {
            streamedText += delta
            const now = Date.now()
            if (deps.transport.capabilities.edit && now - lastEdit >= deps.editThrottleMs) {
              await deps.transport.edit(msg.chatId, initial.messageId, streamCard(streamedText))
              lastEdit = now
            }
          }
        }
      }

      log.info(`SSE stream ended. streamedText length: ${streamedText.length}, assistantMessageId: ${assistantMessageId ?? 'none'}`)

      // Fallback: if SSE yielded no text, fetch the latest assistant message directly
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

      // Fetch cost/tokens for footer
      let footer: string | undefined
      try {
        const sres = await deps.client.session.get({ path: { id: sessionId } })
        const s = (sres.data ?? {}) as any
        const cost = typeof s.cost === 'number' ? s.cost : undefined
        const tok = s.tokens
        const tin = typeof tok?.input === 'number' ? tok.input : undefined
        const tout = typeof tok?.output === 'number' ? tok.output : undefined
        const agentName = s.agent?.name ?? deps.state.getCurrentAgent() ?? ''
        const modelId = typeof s.model === 'string'
          ? s.model.split('/').pop() ?? s.model
          : ''
        if (cost !== undefined) {
          deps.state.setSessionCost(sessionId, cost)
          const parts: string[] = [`💰 $${cost.toFixed(3)}`]
          if (tin !== undefined && tout !== undefined) {
            parts.push(`↑${formatK(tin)} ↓${formatK(tout)}`)
          }
          if (agentName) parts.push(agentName)
          if (modelId) parts.push(modelId)
          footer = parts.join('  ·  ')
        }
      } catch {
        // footer is optional — silently skip
      }

      const card: Card = finalCard(final)
      if (footer) card.footer = footer
      await deps.transport.edit(msg.chatId, initial.messageId, card)
    } catch (err) {
      const e = err as Error
      log.warn('relay error', e.message)
      try {
        await deps.transport.edit(msg.chatId, initial.messageId, errorCard(e.message))
      } catch {}
    } finally {
      clearTimeout(timer)
      deps.state.setActiveAbort(sessionId, undefined)
    }
  }
}
