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

function thinkingCard(): Card {
  return { lines: ['💭 thinking...'] }
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

async function pickSession(client: OpencodeClient, last: string | undefined): Promise<string> {
  if (last) return last
  const res = await client.session.list()
  const sessions = (res.data ?? []) as Array<{ id: string; time?: { created?: number } }>
  if (sessions.length === 0) throw new Error('No opencode sessions found — open TUI first')
  const sorted = [...sessions].sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))
  return sorted[0].id
}

export function createRelay(deps: RelayDeps) {
  return async function handleIncoming(msg: IncomingMessage): Promise<void> {
    const initial = await deps.transport.send(msg.chatId, thinkingCard())
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    try {
      const sessionId = await pickSession(deps.client, deps.state.getLastSessionId())
      deps.state.setLastSessionId(sessionId)

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
          if (!assistantMessageId && typeof p?.messageID === 'string') {
            assistantMessageId = p.messageID
          }
          if (p?.part?.type === 'text' && typeof p.part.id === 'string') {
            textPartIds.add(p.part.id)
          }
          if (showTools && p?.part?.type === 'tool' && typeof p.part.tool === 'string') {
            const tool = p.part.tool
            const input = p.part.state?.input ?? {}
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

        if (e.type === 'message.part.delta') {
          if (!assistantMessageId && typeof p?.messageID === 'string') {
            assistantMessageId = p.messageID
          }
          const partId = p?.partID as string | undefined
          const field = p?.field as string | undefined
          const delta = p?.delta as string | undefined
          if (partId && textPartIds.has(partId) && field === 'text' && delta) {
            streamedText += delta
            const now = Date.now()
            if (deps.transport.capabilities.edit && now - lastEdit >= deps.editThrottleMs) {
              await deps.transport.edit(msg.chatId, initial.messageId, textCard(streamedText))
              lastEdit = now
            }
          }
        }
      }

      const final = streamedText || '(empty response)'
      await deps.transport.edit(msg.chatId, initial.messageId, textCard(final))
    } catch (err) {
      const e = err as Error
      log.warn('relay error', e.message)
      try {
        await deps.transport.edit(msg.chatId, initial.messageId, errorCard(e.message))
      } catch {}
    } finally {
      clearTimeout(timer)
    }
  }
}
