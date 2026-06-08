import { Telegraf } from 'telegraf'
import type { Context } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { IncomingMessage, ChannelCapabilities } from '../../core/types.js'
import type { Transport, TransportStartDeps } from '../interface.js'
import type { SessionState } from '../../core/state.js'
import type { EventStream } from '../../opencode/event-stream.js'
import type { CardBus } from '../../core/card-bus.js'
import { TelegramSessionRenderer } from './renderer.js'
import { registerHandlers } from './handlers.js'
import type { PendingApproval, ApprovalResponse } from './handlers.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('telegram')

export interface TelegramConfig {
  token: string
  allowedUserIds: number[]
  client: OpencodeClient
  state: SessionState
  /** opencode server base URL — required for legacy sidecar mode, optional for Plugin mode. */
  baseUrl?: string
  /** EventStream — required for legacy sidecar mode, optional for Plugin mode. */
  eventStream?: EventStream
}

const CAPS: ChannelCapabilities = {
  edit: true,
  maxMessageLength: 4000,
  buttons: true,
  richText: true,
  streaming: false,
}

/** Extended transport interface with Plugin mode helpers. */
export interface TelegramTransport extends Transport {
  /** Handle a permission event from the Plugin event hook (Plugin mode). */
  handlePluginPermissionEvent(event: { type: string; properties: any }): Promise<void>
}

export function createTelegramTransport(cfg: TelegramConfig): TelegramTransport {
  const bot = new Telegraf(cfg.token, { handlerTimeout: 600_000 })

  // Whitelist middleware
  bot.use(async (ctx, next) => {
    if (!cfg.allowedUserIds.includes(ctx.from?.id ?? -1)) {
      if (ctx.from) log.warn(`rejected from ${ctx.from.id}`)
      await ctx.reply('Unauthorized').catch(() => {})
      return
    }
    await next()
  })

  let messageHandler: ((msg: IncomingMessage) => Promise<void>) | undefined
  let isGenerating = false
  let currentAbortController: AbortController | undefined

  function abortGeneration() {
    currentAbortController?.abort()
  }

  // Wire text handler
  bot.use(async (ctx: Context, next) => {
    if (ctx.callbackQuery) return next()
    const m = ctx.message
    if (!m || !('text' in m)) return next()
    if (m.text.startsWith('/')) return next()
    if (!messageHandler) return next()

    if (isGenerating) {
      void ctx.reply('Session is already generating. Wait for it or /abort.')
      return
    }

    isGenerating = true
    currentAbortController = new AbortController()

    const msg: IncomingMessage = {
      userId: String(ctx.from!.id),
      chatId: String(ctx.chat!.id),
      text: m.text,
      messageId: String(m.message_id),
    }

    void messageHandler(msg).finally(() => {
      isGenerating = false
      currentAbortController = undefined
    })
  })

  // Plugin-mode approval state (used when eventStream is unavailable)
  const pendingApprovals = new Map<string, PendingApproval>()

  // Register commands + callbacks
  registerHandlers({
    bot,
    client: cfg.client,
    baseUrl: cfg.baseUrl ?? '',
    state: cfg.state,
    eventStream: cfg.eventStream as EventStream,
    chatId: cfg.allowedUserIds[0],
    isGenerating: () => isGenerating,
    abortGeneration,
  })

  // Error catch-all
  bot.catch((err, ctx) => {
    log.error('telegraf catch-all', err as Error)
    ctx.reply(`Internal error: ${(err as Error).message}`).catch(() => {})
  })

  // Per-session renderers
  const renderers = new Map<string, TelegramSessionRenderer>()

  function getRenderer(sessionId: string, chatId: string): TelegramSessionRenderer {
    let r = renderers.get(sessionId)
    if (!r) {
      r = new TelegramSessionRenderer({ chatId, sessionId, bot: bot.telegram })
      renderers.set(sessionId, r)
    }
    return r
  }

  function labelFor(response?: string): string {
    switch (response) {
      case 'once':   return 'Allowed (once)'
      case 'always': return 'Always Allowed'
      case 'reject': return 'Rejected'
      default:       return response ?? 'Handled'
    }
  }

  return {
    name: 'telegram',
    capabilities: CAPS,
    async start(deps: TransportStartDeps) {
      const { cardBus } = deps
      const chatId = String(cfg.allowedUserIds[0])

      cardBus.subscribeAll((card) => {
        if ('sessionId' in card && card.sessionId) {
          const r = getRenderer(card.sessionId, chatId)
          log.info(`[telegram] card received: kind=${card.kind} sessionId=${card.sessionId}`)
          r.onCard(card).catch((err) => {
            log.error(`[telegram] onCard failed for ${card.kind}`, err as Error)
          })
          if (card.kind === 'assistant' || card.kind === 'error') {
            renderers.delete(card.sessionId)
          }
        }
      })

      let attempt = 0
      let conflictCount = 0
      const MAX_CONFLICT = 8
      for (;;) {
        try {
          await bot.launch()
          log.info('bot polling ended cleanly')
          return
        } catch (err) {
          const e = err as { response?: { error_code?: number }; message?: string }
          if (e?.response?.error_code === 409) {
            if (++conflictCount >= MAX_CONFLICT) throw new Error('Telegram 409 persisted')
            log.warn(`409 #${conflictCount}, retry in 5s`)
            await new Promise((r) => setTimeout(r, 5000))
          } else {
            attempt += 1
            const delay = Math.min(1000 * 2 ** attempt, 30000)
            log.error(`bot.launch failed (attempt ${attempt})`, e?.message ?? err)
            await new Promise((r) => setTimeout(r, delay))
          }
        }
      }
    },
    async stop() {
      bot.stop('manual')
      const cleanup = (bot as any)._approvalCleanup
      if (typeof cleanup === 'function') cleanup()
    },
    async send(_chatId, _card) {
      throw new Error('Transport.send not implemented for Telegram in v0.5.0')
    },
    onMessage(h) { messageHandler = h },
    onCommand(_name, _h) { /* commands registered via registerHandlers */ },
    onButtonClick(_h) { /* callbacks registered via registerHandlers */ },

    /** Plugin mode: handle permission events from the opencode event hook. */
    async handlePluginPermissionEvent(event: { type: string; properties: any }) {
      const props = event.properties ?? {}

      if (event.type === 'permission.updated' || event.type === 'permission.asked') {
        const permId = props.id as string | undefined
        const title = (props.title as string) ?? (props.permission as string) ?? 'Unknown operation'
        const sessionId = props.sessionID as string | undefined
        if (!permId || !sessionId) {
          log.warn(`Plugin permission: missing id or sessionID`, props)
          return
        }

        const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const text = `Permission Required\n\n${escaped}`
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Once', callback_data: `approve:once:${permId}` },
                { text: 'Always', callback_data: `approve:always:${permId}` },
                { text: 'Reject', callback_data: `approve:reject:${permId}` },
              ],
            ],
          },
          parse_mode: 'HTML' as const,
        }

        try {
          const msg = await bot.telegram.sendMessage(String(cfg.allowedUserIds[0]), text, keyboard)
          pendingApprovals.set(permId, {
            sessionId,
            permissionId: permId,
            messageId: msg.message_id,
            title,
          })
          log.info(`[plugin] approval card sent permId=${permId}`)
        } catch (err) {
          log.error('[plugin] failed to send approval card', err as Error)
        }
      }

      if (event.type === 'permission.replied') {
        const permId = (props.permissionID as string) ?? (props.requestID as string)
        const response = (props.response as string) ?? (props.reply as string)
        if (!permId) return

        const p = pendingApprovals.get(permId)
        if (!p) return

        pendingApprovals.delete(permId)
        try {
          const display = labelFor(response)
          await bot.telegram.editMessageText(
            String(cfg.allowedUserIds[0]),
            p.messageId,
            undefined,
            `${display} (from TUI)\n\n${p.title}`,
            { parse_mode: 'HTML' },
          )
        } catch (err) {
          log.warn(`[plugin] couldn't update card after TUI reply: ${(err as Error).message}`)
        }
      }
    },
  }
}
