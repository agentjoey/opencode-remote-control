import { tool } from '@opencode-ai/plugin'
import type { Plugin } from '@opencode-ai/plugin'
import { loadPluginConfig } from './config.js'
import { createTelegramTransport, type TelegramTransport } from '../transport/telegram/index.js'
import { createWebTransport } from '../transport/web/index.js'
import { createFileBackedState } from '../core/state.js'
import { createRelay } from '../core/relay.js'
import { createCardBus } from '../core/card-bus.js'
import type { Transport } from '../transport/interface.js'
import { createLogger } from '../utils/logger.js'

const VERSION = '0.6.0'
const log = createLogger('plugin')

export const remoteControlPlugin: Plugin = async (ctx, options) => {
  log.info(`v${VERSION} starting`)

  const config = loadPluginConfig(options)
  log.info(`transport=${config.transport}, web=${config.webEnabled}, port=${config.webPort}`)

  const state = createFileBackedState(config.statePath)
  const cardBus = createCardBus()

  const relay = createRelay({
    cardBus,
    client: ctx.client,
    state,
    chatTimeoutMs: config.chatTimeoutMs,
    tuiVisible: config.tuiVisible,
  })

  const tgTransport = createTelegramTransport({
    token: config.telegramBotToken,
    allowedUserIds: config.allowedUserIds,
    client: ctx.client,
    state,
  })

  const transports: Transport[] = [tgTransport]
  tgTransport.onMessage(relay)

  if (config.webEnabled) {
    const webT = createWebTransport({
      host: config.webHost,
      port: config.webPort,
      client: ctx.client,
      cfAccess: {
        team: config.webCfAccessTeam,
        aud: config.webCfAccessAud,
        devBypass: config.webCfAccessDevBypass,
        devEmail: config.webCfAccessDevEmail,
      },
      staticRoot: config.webStaticRoot,
      cacheSize: config.webCacheSize,
    })
    transports.push(webT)
  }

  await Promise.all(transports.map((t) => t.start({ cardBus, state })))
  log.info(`${transports.length} transport(s) started`)

  return {
    event: async ({ event }) => {
      const eventType = (event as any)?.type
      if (!eventType) return

      switch (eventType) {
        case 'permission.asked':
        case 'permission.replied':
        case 'permission.updated':
          tgTransport.handlePluginPermissionEvent(event as any).catch((err) =>
            log.error('handlePluginPermissionEvent failed', err as Error),
          )
          await relay.handleEvent(event)
          break
        case 'session.idle':
        case 'session.error':
        case 'session.created':
        case 'session.deleted':
        case 'session.updated':
        case 'session.status':
        case 'message.part.updated':
        case 'message.updated':
        case 'message.part.removed':
        case 'message.removed':
        case 'command.executed':
          await relay.handleEvent(event)
          break
      }
    },
    tool: {
      'rc-status': tool({
        description: 'Show opencode-remote-control plugin status',
        args: {},
        async execute() {
          const lines = [
            `Remote Control v${VERSION}`,
            `Telegram: ${tgTransport ? 'active' : 'inactive'}`,
            `Web:     ${config.webEnabled ? `listening :${config.webPort}` : 'disabled'}`,
          ]
          return lines.join('\n')
        },
      }),
    },
  }
}

export default remoteControlPlugin
