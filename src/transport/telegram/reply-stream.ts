import type { Context } from 'telegraf'
import { chunkMessage } from '../../utils/markdown.js'

interface ReplyStreamOpts {
  throttleMs: number
  maxLength: number
}

export interface ReplyStream {
  update(text: string): Promise<void>
  finalize(text: string): Promise<void>
}

export function createReplyStream(
  ctx: Context,
  messageId: number,
  opts: ReplyStreamOpts,
): ReplyStream {
  let lastEditAt = 0
  const EDIT_HARD_LIMIT = 4000 // Telegram editMessageText body limit (4096; leave headroom)

  return {
    async update(text: string): Promise<void> {
      const now = Date.now()
      if (now - lastEditAt < opts.throttleMs) return
      lastEditAt = now
      const body = text.length > EDIT_HARD_LIMIT ? text.slice(0, EDIT_HARD_LIMIT) : text
      try {
        await ctx.telegram.editMessageText(ctx.chat!.id, messageId, undefined, body)
      } catch {
        // 400 (same content / deleted) and 429 (rate limit) are non-fatal
      }
    },

    async finalize(text: string): Promise<void> {
      try {
        await ctx.deleteMessage(messageId)
      } catch {
        // Status message may already be gone
      }
      const body = text || '(empty response)'
      for (const chunk of chunkMessage(body, opts.maxLength)) {
        await ctx.reply(chunk)
      }
    },
  }
}
