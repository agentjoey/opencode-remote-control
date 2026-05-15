import type { Context } from 'telegraf'
import type { Message } from '@telegraf/types'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { TuiBridge, TuiSubmitError } from '../../opencode/tui-bridge.js'
import { EventStream } from '../../opencode/event-stream.js'
import { createReplyStream } from '../reply.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('chat')

interface ChatDeps {
  tuiBridge: TuiBridge
  eventStream: EventStream
  client: OpencodeClient
  editThrottleMs: number
  chatTimeoutMs: number
  getLastSessionId: () => string | undefined
  setLastSessionId: (id: string) => void
  onAbortControllerCreated?: (ac: AbortController) => void
  isUserAborted?: () => boolean
}

// Opencode 1.14.x event shapes (verified empirically):
//   - message.part.delta       { sessionID, messageID, partID, field, delta }
//   - session.status           { sessionID, status: { type: 'busy'|'idle' } }
//   - session.idle             { sessionID }
//   - session.error            { sessionID?, error? }
//
// Parts come in mixed types (step-start / reasoning / text / step-finish),
// but the delta events don't carry the part type. So we wait for idle, then
// fetch the message and emit only the `type=text` part contents.

export function createChatHandler(deps: ChatDeps) {
  return async function handleChat(ctx: Context, text: string): Promise<void> {
    const statusMsg = (await ctx.reply('💭 thinking...')) as Message.TextMessage
    const replyStream = createReplyStream(ctx, statusMsg.message_id, {
      throttleMs: deps.editThrottleMs,
      maxLength: 4000,
    })

    const typingInterval = setInterval(() => {
      ctx.sendChatAction('typing').catch(() => {})
    }, 4000)

    const ac = new AbortController()
    deps.onAbortControllerCreated?.(ac)
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    let sessionId: string | undefined
    let assistantMessageId: string | undefined
    let deltaCount = 0
    let fullText = ''

    try {
      sessionId = await deps.tuiBridge.submit(text, deps.getLastSessionId())
      deps.setLastSessionId(sessionId)

      for await (const ev of deps.eventStream.session(sessionId, ac.signal)) {
        const e = ev as { type: string; properties: any }

        if (e.type === 'session.idle') break
        if (e.type === 'session.status' && e.properties?.status?.type === 'idle') break
        if (e.type === 'session.error') {
          const err = e.properties?.error
          const errMsg = err?.data?.message ?? err?.message ?? err?.name ?? 'opencode reported a session error'
          throw new Error(errMsg)
        }
        if (e.type === 'message.part.delta') {
          // Capture the assistant messageID from the first delta
          if (!assistantMessageId && typeof e.properties?.messageID === 'string') {
            assistantMessageId = e.properties.messageID
          }
          // Progress indicator: every ~20 deltas, append a dot
          deltaCount += 1
          if (deltaCount % 20 === 0) {
            await replyStream.update(`💭 generating${'.'.repeat(Math.min((deltaCount / 20) | 0, 6))}`)
          }
        }
      }

      if (deps.isUserAborted?.()) throw new Error('user_abort')
      if (ac.signal.aborted) throw new Error('timeout')

      // Pull the final assistant message and emit only text parts
      if (assistantMessageId) {
        try {
          const msgResult = await deps.client.session.message({
            path: { id: sessionId, messageID: assistantMessageId },
          })
          const data = msgResult.data as { parts?: Array<{ type?: string; text?: string }> } | undefined
          const textParts = (data?.parts ?? [])
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .filter((s) => s.length > 0)
          fullText = textParts.join('\n\n')
        } catch (err) {
          log.warn('failed to fetch final message', (err as Error).message)
        }
      }

      // Fallback: if no text captured, list session messages and grab last assistant
      if (!fullText) {
        try {
          const listResult = await deps.client.session.messages({ path: { id: sessionId } })
          const items = (listResult.data ?? []) as Array<{
            info?: { role?: string; id?: string }
            parts?: Array<{ type?: string; text?: string }>
          }>
          const lastAsst = [...items].reverse().find((m) => m.info?.role === 'assistant')
          if (lastAsst) {
            fullText = (lastAsst.parts ?? [])
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .filter((s) => s.length > 0)
              .join('\n\n')
          }
        } catch (err) {
          log.warn('failed to list session messages', (err as Error).message)
        }
      }

      await replyStream.finalize(fullText)
    } catch (err) {
      const errAny = err as Error
      if (errAny instanceof TuiSubmitError) {
        const msg =
          errAny.reason === 'no_session'
            ? '❌ No opencode session available. Open the TUI on your Mac first.'
            : errAny.reason === 'session_busy'
            ? '⏳ Session is already generating. Wait for it or /abort.'
            : errAny.reason === 'unreachable'
            ? '❌ opencode is unreachable — is `opencode serve --port 4096` running?'
            : `❌ ${errAny.message}`
        try { await ctx.deleteMessage(statusMsg.message_id) } catch {}
        await ctx.reply(msg)
      } else if (errAny.message === 'user_abort') {
        try { await ctx.deleteMessage(statusMsg.message_id) } catch {}
        await ctx.reply('🛑 Generation stopped.')
      } else if (errAny.message === 'timeout') {
        try { await ctx.deleteMessage(statusMsg.message_id) } catch {}
        await ctx.reply(`⏱ Request timed out (${deps.chatTimeoutMs}ms). Try /abort then resend.`)
      } else {
        log.error('chat handler failed', errAny)
        try { await ctx.deleteMessage(statusMsg.message_id) } catch {}
        await ctx.reply(`❌ ${errAny.message}`)
      }
    } finally {
      clearTimeout(timer)
      clearInterval(typingInterval)
    }
  }
}
