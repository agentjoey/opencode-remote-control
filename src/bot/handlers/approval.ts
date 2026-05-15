import type { Telegraf } from 'telegraf'
import { Markup } from 'telegraf'
import { EventStream } from '../../opencode/event-stream.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('approval')

interface PendingApproval {
  sessionId: string
  permissionId: string
  messageId: number
  title: string
}

interface ApprovalDeps {
  bot: Telegraf
  eventStream: EventStream
  baseUrl: string
  chatId: number
}

type ApprovalResponse = 'once' | 'always' | 'reject'

export function setupApprovalHandler(deps: ApprovalDeps): () => void {
  const pending = new Map<string, PendingApproval>()

  // Listen for permission.updated → push card
  const offUpdated = deps.eventStream.onAny(async (rawEvent: unknown) => {
    const ev = rawEvent as { type: string; properties: any }
    if (ev.type !== 'permission.updated') return

    const permId = ev.properties?.id as string | undefined
    const title = (ev.properties?.title as string | undefined) ?? 'Unknown operation'
    const sessionId = ev.properties?.sessionID as string | undefined
    if (!permId || !sessionId) {
      log.warn('permission.updated missing id or sessionID', ev.properties)
      return
    }

    const text = `🔐 Approval Required\n\n${title}`
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Allow Once', `approve:once:${permId}`),
        Markup.button.callback('🔓 Always', `approve:always:${permId}`),
      ],
      [Markup.button.callback('❌ Reject', `approve:reject:${permId}`)],
    ])

    try {
      const msg = await deps.bot.telegram.sendMessage(deps.chatId, text, keyboard)
      pending.set(permId, {
        sessionId,
        permissionId: permId,
        messageId: msg.message_id,
        title,
      })
      log.info(`approval card sent permId=${permId}`)
    } catch (err) {
      log.error('failed to send approval card', err as Error)
    }
  })

  // Telegram button click → POST reply to opencode
  deps.bot.action(/^approve:(once|always|reject):(.+)$/, async (ctx) => {
    const match = ctx.match as RegExpMatchArray
    const response = match[1] as ApprovalResponse
    const permId = match[2]
    const p = pending.get(permId)

    if (!p) {
      await ctx.answerCbQuery('This request has already been handled.')
      return
    }

    try {
      const res = await fetch(`${deps.baseUrl}/permission/${permId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      log.error(`failed to reply permission ${permId}`, err as Error)
      await ctx.answerCbQuery('Failed to reply. The request may have expired.')
      return
    }

    pending.delete(permId)

    const labels: Record<ApprovalResponse, string> = {
      once: '✅ Allowed (once)',
      always: '🔓 Always Allowed',
      reject: '❌ Rejected',
    }
    const display = labels[response]
    await ctx.editMessageText(`${display}\n\n${p.title}`).catch(() => {})
    await ctx.answerCbQuery(display)
  })

  // Mirror: TUI replied locally → update the Telegram card
  const offReplied = deps.eventStream.onAny(async (rawEvent: unknown) => {
    const ev = rawEvent as { type: string; properties: any }
    if (ev.type !== 'permission.replied') return

    const permId = ev.properties?.permissionID as string | undefined
    const response = ev.properties?.response as string | undefined
    if (!permId) return

    const p = pending.get(permId)
    if (!p) return

    pending.delete(permId)
    try {
      await deps.bot.telegram.editMessageText(
        deps.chatId,
        p.messageId,
        undefined,
        `${labelFor(response)} (from TUI)\n\n${p.title}`,
      )
    } catch (err) {
      log.warn(`couldn't update card after TUI reply: ${(err as Error).message}`)
    }
  })

  return () => {
    offUpdated()
    offReplied()
  }
}

function labelFor(response?: string): string {
  switch (response) {
    case 'once':   return '✅ Allowed (once)'
    case 'always': return '🔓 Always Allowed'
    case 'reject': return '❌ Rejected'
    default:       return response ?? 'Handled'
  }
}
