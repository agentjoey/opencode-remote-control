import type { OpencodeClient } from '@opencode-ai/sdk'
import type { Transport } from '../transport/interface.js'
import type { Card, IncomingMessage } from './types.js'
import type { SessionState } from './state.js'
import type { EventStream } from '../opencode/event-stream.js'
import { submitPrompt } from '../opencode/submit.js'
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
  const card: Card = { lines: ['💭 thinking...'] }
  if (showStop) {
    card.buttons = [[{ label: '⏹ Stop', data: `relay:abort:${sessionId}` }]]
  }
  return card
}

function errorCard(msg: string): Card {
  return { lines: [`❌ ${msg}`] }
}

function textCard(text: string): Card {
  return { lines: [text] }
}

function summarizeToolArgs(tool: string, input: any): string {
  if (tool === 'bash') return (input.command ?? '').slice(0, 60)
  if (tool === 'read' || tool === 'edit' || tool === 'write') return input.filePath ?? ''
  if (tool === 'grep' || tool === 'find') return input.pattern ?? input.query ?? ''
  return ''
}

const MAX_TOOL_LINES = 30

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

      // SDK-native submission with overrides
      await submitPrompt(deps.client, {
        text: msg.text,
        sessionId,
        agent: deps.state.getNextAgent(),
        model: deps.state.getNextModel(),
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

        if (e.type === 'session.idle') break
        if (e.type === 'session.status' && p?.status?.type === 'idle') break
        if (e.type === 'session.error') {
          const err = p?.error
          const msg = err?.data?.message ?? err?.message ?? err?.name ?? 'session error'
          throw new Error(msg)
        }

        if (e.type === 'message.part.updated') {
          const part = p?.part
          if (!part) continue

          // Track assistant message ID
          if (!assistantMessageId && typeof part.messageID === 'string') {
            assistantMessageId = part.messageID
          }

          // Handle text parts with delta
          if (part.type === 'text') {
            // Track this text part ID
            if (typeof part.id === 'string') {
              textPartIds.add(part.id)
            }
            // Apply delta if present
            if (typeof p.delta === 'string') {
              streamedText += p.delta
              const now = Date.now()
              if (deps.transport.capabilities.edit && now - lastEdit >= deps.editThrottleMs) {
                await deps.transport.edit(msg.chatId, initial.messageId, textCard(streamedText))
                lastEdit = now
              }
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
                await deps.transport.edit(msg.chatId, initial.messageId, textCard(streamedText))
                lastEdit = now
              }
            }
          }
        }
      }

      // Fallback: if SSE yielded no text, fetch the latest assistant message directly
      let final = streamedText
      if (!final && assistantMessageId) {
        try {
          const mres = await deps.client.session.message({ path: { id: sessionId, messageId: assistantMessageId } })
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
          log.debug('fallback fetch message failed', (err as Error).message)
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
        const modelId = typeof s.model === 'string' ? s.model : ''
        if (cost !== undefined) {
          const parts: string[] = [`· $${cost.toFixed(2)}`]
          if (tin !== undefined && tout !== undefined) {
            parts.push(`· ${formatK(tin)} in / ${formatK(tout)} out`)
          }
          if (agentName) parts.push(`· ${agentName}`)
          if (modelId) parts.push(`· ${modelId}`)
          footer = parts.join(' ')
          deps.state.setSessionCost(sessionId, cost)
        }
      } catch {
        // Silently skip footer if cost unavailable
      }

      const card: Card = textCard(final)
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
