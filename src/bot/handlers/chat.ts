import type { Context } from 'telegraf'
import type { Message } from '@telegraf/types'
import { TuiBridge, TuiSubmitError } from '../../opencode/tui-bridge.js'
import { EventStream } from '../../opencode/event-stream.js'
import { createReplyStream } from '../reply.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('chat')

interface ChatDeps {
  tuiBridge: TuiBridge
  eventStream: EventStream
  editThrottleMs: number
  chatTimeoutMs: number
  getLastSessionId: () => string | undefined
  setLastSessionId: (id: string) => void
}

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
    const timer = setTimeout(() => ac.abort(), deps.chatTimeoutMs)

    let sessionId: string | undefined
    let fullText = ''

    try {
      sessionId = await deps.tuiBridge.submit(text, deps.getLastSessionId())
      deps.setLastSessionId(sessionId)

      for await (const ev of deps.eventStream.session(sessionId, ac.signal)) {
        const e = ev as { type: string; properties: any }

        if (e.type === 'session.idle') break
        if (e.type === 'session.error') {
          const err = e.properties?.error
          const errMsg = err?.data?.message ?? err?.message ?? err?.name ?? 'opencode reported a session error'
          throw new Error(errMsg)
        }
        if (e.type === 'message.part.updated') {
          const part = e.properties?.part
          if (part?.type === 'text') {
            // Assistant text only; user echo also has part.type === 'text' but a different role
            // Distinguish by part.messageID -> not 100% reliable here; rely on a heuristic:
            // assistant part deltas typically grow text/delta — we just track the latest non-empty text
            if (typeof part.text === 'string' && part.text.length > 0) {
              fullText = part.text
            } else if (typeof e.properties.delta === 'string') {
              fullText += e.properties.delta
            }
            await replyStream.update(fullText)
          }
        }
      }

      if (ac.signal.aborted) throw new Error('timeout')
      await replyStream.finalize(fullText)
    } catch (err) {
      const errAny = err as Error
      if (errAny instanceof TuiSubmitError) {
        const msg =
          errAny.reason === 'no_session'
            ? '❌ No opencode session available. Open the TUI on your Mac first.'
            : errAny.reason === 'session_busy'
            ? '⏳ Session is already generating. Wait for it or /abort.'
            : `❌ ${errAny.message}`
        try { await ctx.deleteMessage(statusMsg.message_id) } catch {}
        await ctx.reply(msg)
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
