import { tool } from '@opencode-ai/plugin'
import type { Plugin } from '@opencode-ai/plugin'
import { loadPluginConfig } from './config.js'
import { createTelegramTransport, type TelegramTransport } from '../transport/telegram/index.js'
import { createWebTransport } from '../transport/web/index.js'
import { createFileBackedState } from '../core/state.js'
import { createRelay } from '../core/relay.js'
import { createCardBus } from '../core/card-bus.js'
import { startPushNotifications } from '../core/push.js'
import type { Transport } from '../transport/interface.js'
import { createLogger } from '../utils/logger.js'

const VERSION = '0.6.0'
const log = createLogger('plugin')

export const remoteControlPlugin: Plugin = async (ctx, options) => {
  log.info(`v${VERSION} starting`)

  const config = loadPluginConfig(options)
  log.info(`transport=${config.transport}, web=${config.webEnabled}, port=${config.webPort}, baseUrl=${config.baseUrl}`)

  const state = createFileBackedState(config.statePath)
  const cardBus = createCardBus()

  const relay = createRelay({
    cardBus,
    client: ctx.client,
    state,
    chatTimeoutMs: config.chatTimeoutMs,
    tuiVisible: config.tuiVisible,
    baseUrl: config.baseUrl,
  })

  const tgTransport = createTelegramTransport({
    token: config.telegramBotToken,
    allowedUserIds: config.allowedUserIds,
    client: ctx.client,
    state,
    baseUrl: config.baseUrl,
  })

  const transports: Transport[] = [tgTransport]
  tgTransport.onMessage(relay)

  let webTransport: ReturnType<typeof createWebTransport> | undefined

  if (config.webEnabled) {
    webTransport = createWebTransport({
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
    webTransport.onMessage(relay)
    transports.push(webTransport)
  }

  // Start transports in background — bot.launch() blocks on polling and must not hold up plugin init.
  // The event hook must be returned immediately so opencode can dispatch events.
  Promise.all(transports.map((t) => t.start({ cardBus, state })))
    .then(() => {
      log.info(`${transports.length} transport(s) started successfully`)
    })
    .catch((err) => {
      log.error('transport start failed', err as Error)
    })

  // Push notifications — plugin mode (event-driven instead of EventStream)
  const push = startPushNotifications({ cardBus, client: ctx.client })

  // Poll the TUI-selected session to keep current agent in sync (plugin mode equivalent of tui-sync)
  const pollTimer = setInterval(async () => {
    const sid = state.getTuiSelectedSession()
    if (!sid) return
    try {
      const res = await ctx.client.session.get({ path: { id: sid } } as any)
      const data = res.data as { agent?: string } | undefined
      if (data?.agent) state.setCurrentAgent(data.agent)
    } catch {
      // best effort
    }
  }, 5000)

  return {
    event: async ({ event }) => {
      const eventType = (event as any)?.type
      if (!eventType) return

      // Feed all events to push notification engine
      push.handleEvent(event)

      switch (eventType) {
        case 'permission.asked':
        case 'permission.replied':
        case 'permission.updated':
          tgTransport.handlePluginPermissionEvent(event as any).catch((err) =>
            log.error('handlePluginPermissionEvent failed', err as Error),
          )
          await relay.handleEvent(event)
          break
        case 'tui.session.select': {
          const sid = (event as any)?.properties?.sessionID
          if (typeof sid === 'string' && sid) {
            state.setTuiSelectedSession(sid)
            log.info(`[plugin] TUI session select: ${sid.slice(-8)}`)
          }
          break
        }
        case 'session.idle':
        case 'session.error':
        case 'session.created':
        case 'session.deleted':
        case 'session.updated':
        case 'session.status':
        case 'message.part.updated':
        case 'message.part.delta':
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
    dispose: async () => {
      log.info('plugin disposing, stopping transports...')
      clearInterval(pollTimer)
      push.stop()
      await Promise.allSettled(transports.map((t) => t.stop()))
      log.info('plugin disposed')
    },
  }
}

export default remoteControlPlugin
