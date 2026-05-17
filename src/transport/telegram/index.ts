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
import { createLogger } from '../../utils/logger.js'

const log = createLogger('telegram')

export interface TelegramConfig {
  token: string
  allowedUserIds: number[]
  baseUrl: string
  client: OpencodeClient
  eventStream: EventStream
  state: SessionState
}

const CAPS: ChannelCapabilities = {
  edit: true,
  maxMessageLength: 4000,
  buttons: true,
  richText: true,
  streaming: false,
}

export function createTelegramTransport(cfg: TelegramConfig): Transport {
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
  const commandHandlers = new Map<string, (msg: IncomingMessage) => Promise<void>>()
  let buttonHandler: ((data: string, msg: IncomingMessage) => Promise<void>) | undefined

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
      void ctx.reply('⏳ Session is already generating. Wait for it or /abort.')
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

  // Register commands + callbacks
  registerHandlers({
    bot,
    client: cfg.client,
    baseUrl: cfg.baseUrl,
    state: cfg.state,
    eventStream: cfg.eventStream,
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

  return {
    name: 'telegram',
    capabilities: CAPS,
    async start(deps: TransportStartDeps) {
      const { cardBus } = deps
      const chatId = String(cfg.allowedUserIds[0])

      cardBus.subscribeAll((card) => {
        if ('sessionId' in card && card.sessionId) {
          const r = getRenderer(card.sessionId, chatId)
          void r.onCard(card)
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
  }
}
