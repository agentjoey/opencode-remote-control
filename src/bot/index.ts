import { Telegraf, Markup } from 'telegraf'
import type { Context } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { Config } from '../config.js'
import { TuiBridge } from '../opencode/tui-bridge.js'
import { EventStream } from '../opencode/event-stream.js'
import { createChatHandler } from './handlers/chat.js'
import { setupApprovalHandler } from './handlers/approval.js'
import { registerCommands } from './handlers/commands.js'
import { registerCallbacks } from './handlers/callbacks.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('bot')

interface BotDeps {
  config: Config
  client: OpencodeClient
  eventStream: EventStream
}

export function createBot(deps: BotDeps): Telegraf {
  const bot = new Telegraf(deps.config.telegramBotToken, {
    handlerTimeout: 600_000,
  })

  let lastSessionId: string | undefined
  let isGenerating = false
  let currentAbortController: AbortController | undefined
  let userAbortedGeneration = false

  // Auto-track most recently active session from SSE events so the bot
  // naturally follows whatever session the TUI is using.
  deps.eventStream.onAny((rawEvent) => {
    const e = rawEvent as { properties?: any }
    const p = e?.properties
    const sid =
      (typeof p?.sessionID === 'string' && p.sessionID) ||
      (typeof p?.part?.sessionID === 'string' && p.part.sessionID) ||
      (typeof p?.info?.sessionID === 'string' && p.info.sessionID) ||
      undefined
    if (sid) lastSessionId = sid
  })

  // Whitelist middleware
  bot.use(async (ctx, next) => {
    const fromId = ctx.from?.id
    if (fromId !== deps.config.allowedUserId) {
      if (fromId) log.warn(`rejected message from user ${fromId}`)
      await ctx.reply('Unauthorized').catch(() => {})
      return
    }
    await next()
  })

  // Commands
  registerCommands({
    bot,
    client: deps.client,
    baseUrl: deps.config.opencodeBaseUrl,
    getLastSessionId: () => lastSessionId,
    setLastSessionId: (id) => { lastSessionId = id },
    abortGeneration: () => {
      userAbortedGeneration = true
      currentAbortController?.abort()
    },
    isGenerating: () => isGenerating,
  })

  // Callbacks
  registerCallbacks({
    bot,
    baseUrl: deps.config.opencodeBaseUrl,
    getLastSessionId: () => lastSessionId,
    setLastSessionId: (id) => { lastSessionId = id },
    isGenerating: () => isGenerating,
    abortGeneration: () => {
      userAbortedGeneration = true
      currentAbortController?.abort()
    },
  })

  // Chat handler
  const tuiBridge = new TuiBridge(deps.config.opencodeBaseUrl, deps.client)
  deps.eventStream.setStatusChecker(() => tuiBridge.getStatus())
  const handleChat = createChatHandler({
    tuiBridge,
    eventStream: deps.eventStream,
    client: deps.client,
    editThrottleMs: deps.config.editThrottleMs,
    chatTimeoutMs: deps.config.chatTimeoutMs,
    getLastSessionId: () => lastSessionId,
    setLastSessionId: (id) => { lastSessionId = id },
    onAbortControllerCreated: (ac) => { currentAbortController = ac },
    isUserAborted: () => userAbortedGeneration,
  })

  bot.on('text', (ctx: Context) => {
    const message = ctx.message
    if (!message || !('text' in message)) return
    if (message.text.startsWith('/')) return

    if (isGenerating) {
      void ctx.reply('⏳ Session is already generating. Wait for it or /abort.')
      return
    }

    isGenerating = true
    userAbortedGeneration = false

    void handleChat(ctx, message.text).finally(() => {
      isGenerating = false
      currentAbortController = undefined
    })
  })

  // Approval handler
  setupApprovalHandler({
    bot,
    eventStream: deps.eventStream,
    baseUrl: deps.config.opencodeBaseUrl,
    chatId: deps.config.allowedUserId,
  })

  // Error catch-all
  bot.catch((err, ctx) => {
    log.error('telegraf catch-all', err as Error)
    ctx.reply(`Internal error: ${(err as Error).message}`).catch(() => {})
  })

  return bot
}
