import { Telegraf, Markup } from 'telegraf'
import type { Context } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { Card, IncomingMessage, ChannelCapabilities } from '../../core/types.js'
import type { Transport } from '../interface.js'
import type { SessionState } from '../../core/state.js'
import type { EventStream } from '../../opencode/event-stream.js'
import { cardToTelegram } from './render.js'
import { registerHandlers } from './handlers.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('telegram')

export interface TelegramConfig {
  token: string
  allowedUserId: number
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
    if (ctx.from?.id !== cfg.allowedUserId) {
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
  bot.on('text', (ctx: Context) => {
    const m = ctx.message
    if (!m || !('text' in m)) return
    if (m.text.startsWith('/')) return  // commands handled separately
    if (!messageHandler) return

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
    chatId: cfg.allowedUserId,
    isGenerating: () => isGenerating,
    abortGeneration,
  })

  // Error catch-all
  bot.catch((err, ctx) => {
    log.error('telegraf catch-all', err as Error)
    ctx.reply(`Internal error: ${(err as Error).message}`).catch(() => {})
  })

  return {
    name: 'telegram',
    capabilities: CAPS,
    async start() {
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
    async send(chatId, card) {
      const { text, options } = cardToTelegram(card)
      const sent = await bot.telegram.sendMessage(chatId, text, options as any)
      return { messageId: String(sent.message_id) }
    },
    async edit(chatId, messageId, card) {
      const { text, options } = cardToTelegram(card)
      try {
        await bot.telegram.editMessageText(chatId, Number(messageId), undefined, text, options as any)
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('message is not modified')) return
        log.warn('edit failed', msg)
      }
    },
    async delete(chatId, messageId) {
      try { await bot.telegram.deleteMessage(chatId, Number(messageId)) } catch {}
    },
    onMessage(h) { messageHandler = h },
    onCommand(name, h) { commandHandlers.set(name, h) },
    onButtonClick(h) { buttonHandler = h },
  }
}
