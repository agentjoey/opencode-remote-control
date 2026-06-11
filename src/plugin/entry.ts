import { tool } from '@opencode-ai/plugin'
import type { Plugin } from '@opencode-ai/plugin'
import { loadPluginConfig } from './config.js'
import { createTelegramTransport, type TelegramTransport } from '../transport/telegram/index.js'
import { createWebTransport } from '../transport/web/index.js'
import { selectAuthStrategy } from '../connectivity/auth/select.js'
import { createFileBackedState } from '../core/state.js'
import { createRelay } from '../core/relay.js'
import { createCardBus } from '../core/card-bus.js'
import { startPushNotifications } from '../core/push.js'
import { tryBecomePrimary } from '../core/primary-election.js'
import { startGlobalEvents } from '../opencode/global-events.js'
import type { OcEvent } from '../core/opencode-events.js'
import type { Transport } from '../transport/interface.js'
import { createLogger } from '../utils/logger.js'

const VERSION = '0.6.0'
const log = createLogger('plugin')

// opencode 1.17 runs plugins in a worker thread. Any unhandled rejection or
// uncaught exception in our long-lived services (web server, telegram polling,
// timers) would otherwise crash that worker — opencode reports "Worker has been
// terminated", the web transport dies (→ 502 at the tunnel), and opencode's own
// session reads start failing. Absorb them here: log and keep the worker alive.
// We deliberately NEVER call process.exit (opencode issue #27557: plugins that
// exit on rejection take the host down with them).
let guardsInstalled = false
function installProcessGuards() {
  if (guardsInstalled) return
  guardsInstalled = true
  process.on('unhandledRejection', (reason) => {
    log.warn(`unhandledRejection absorbed: ${(reason as Error)?.stack ?? String(reason)}`)
  })
  process.on('uncaughtException', (err) => {
    log.warn(`uncaughtException absorbed: ${err?.stack ?? String(err)}`)
  })
}

export const remoteControlPlugin: Plugin = async (ctx, options) => {
  installProcessGuards()
  log.info(`v${VERSION} starting`)

  const config = loadPluginConfig(options)

  const primary = tryBecomePrimary()
  if (!primary.isPrimary) {
    log.info('PASSIVE instance — web/bot/events owned by another opencode instance; standing down')
    return {
      // Minimal inert hooks: do nothing, so this workspace's plugin never
      // competes for the web port or the Telegram bot. The PRIMARY instance's
      // global event stream already covers this workspace.
      event: async () => { /* no-op (PASSIVE) */ },
      dispose: async () => { primary.release() },
    }
  }

  log.info(`transport=${config.transport}, web=${config.webEnabled}, port=${config.webPort}, baseUrl=${config.baseUrl}`)

  try {
    const state = createFileBackedState(config.statePath)
    const cardBus = createCardBus()

    const serverUrl = ctx.serverUrl.toString().replace(/\/+$/, '')

    const relay = createRelay({
      cardBus,
      client: ctx.client,
      state,
      chatTimeoutMs: config.chatTimeoutMs,
      tuiVisible: config.tuiVisible,
      baseUrl: serverUrl,
    })

    const tgTransport = createTelegramTransport({
      token: config.telegramBotToken,
      allowedUserIds: config.allowedUserIds,
      client: ctx.client,
      state,
      baseUrl: serverUrl,
      tgChunkSoftLimit: config.tgChunkSoftLimit,
    })

    const transports: Transport[] = [tgTransport]
    tgTransport.onMessage(relay)

    let webTransport: ReturnType<typeof createWebTransport> | undefined

    if (config.webEnabled) {
      const auth = selectAuthStrategy({
        mode: config.webAuth,
        token: config.webToken,
        devEmail: config.webCfAccessDevEmail,
        devBypass: config.webCfAccessDevBypass,
        host: config.webHost,
        cfAccess: {
          team: config.webCfAccessTeam,
          aud: config.webCfAccessAud,
          devBypass: config.webCfAccessDevBypass,
          devEmail: config.webCfAccessDevEmail,
          host: config.webHost,
        },
      })
      webTransport = createWebTransport({
        host: config.webHost,
        port: config.webPort,
        client: ctx.client,
        auth,
        staticRoot: config.webStaticRoot,
        cacheSize: config.webCacheSize,
        baseUrl: serverUrl,
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

    // Push notifications — driven by the plugin event hook
    const push = startPushNotifications({ cardBus, client: ctx.client, state })

    // Poll the TUI-selected session to keep the current agent in sync.
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
    }, 15000)

    // Unified event dispatch. Driven by the PRIMARY's cross-workspace global
    // event stream (startGlobalEvents below), so this runs for events from every
    // workspace — not just this plugin instance's directory. The per-instance
    // `event` hook is intentionally inert (see below) to avoid double-processing.
    async function dispatchEvent(ev: OcEvent): Promise<void> {
      const eventType = ev.type
      if (!eventType) return

      // Feed all events to push notification engine
      push.handleEvent(ev)

      switch (eventType) {
        case 'permission.asked':
        case 'permission.replied':
        case 'permission.updated':
          tgTransport.handlePluginPermissionEvent({ type: eventType, properties: (ev as any).properties } as any).catch((err) =>
            log.error('handlePluginPermissionEvent failed', err as Error),
          )
          try { await relay.handleEvent(ev) } catch (err) {
            log.error('relay.handleEvent failed', err as Error)
          }
          break
        case 'tui.session.select': {
          const sid = (ev as any)?.properties?.sessionID
          if (typeof sid === 'string' && sid) {
            state.setTuiSelectedSession(sid)
            log.info(`[plugin] TUI session select: ${sid.slice(-8)}`)
          }
          break
        }
        case 'session.deleted': {
          // Free per-session memory (card buffer, costs, delivery marks, aborts).
          const sid = (ev as any)?.properties?.sessionID ?? (ev as any)?.properties?.info?.id
          if (typeof sid === 'string' && sid) {
            cardBus.drop(sid)
            state.dropSession(sid)
            log.info(`[plugin] session deleted, evicted: ${sid.slice(-8)}`)
          }
          break
        }
        case 'session.idle':
        case 'session.error':
        case 'session.created':
        case 'session.updated':
        case 'session.status':
        case 'message.part.updated':
        case 'message.part.delta':
        case 'message.updated':
        case 'message.part.removed':
        case 'message.removed':
        case 'command.executed':
          try { await relay.handleEvent(ev) } catch (err) {
            log.error('relay.handleEvent failed', err as Error)
          }
          break
      }
    }

    const globalEvents = startGlobalEvents({
      client: ctx.client,
      // dispatchEvent is intentionally detached (void): events are not serialized
      // against each other. relay.handleEvent's hot streaming paths
      // (message.part.updated/delta) mutate per-session state synchronously, so
      // there is no ordering hazard today. If relay.handleEvent ever awaits I/O on
      // streaming events, this will need a serialising queue.
      onEvent: (ev) => { void dispatchEvent(ev) },
    })

    return {
      event: async () => {
        // Events are consumed via the PRIMARY's global event stream
        // (startGlobalEvents), which covers every workspace — not just this
        // instance's. The per-instance hook is intentionally inert to avoid
        // double-processing local events.
      },
      tool: {
        'rc-status': tool({
          description: 'Show opencode-remote-control plugin status',
          args: {},
          async execute() {
            const s = push.stats()
            const lines = [
              `Remote Control v${VERSION}`,
              `Telegram:   ${tgTransport ? 'active' : 'inactive'}`,
              `Web:        ${config.webEnabled ? `listening :${config.webPort}` : 'disabled'}`,
              `Generating: ${state.hasActiveGeneration() ? 'yes' : 'no'}`,
              `Pushes/hr:  ${s.pushesLastHour}  (tracked sessions: ${s.trackedSessions})`,
            ]
            return lines.join('\n')
          },
        }),
      },
      dispose: async () => {
        log.info('plugin disposing, stopping transports...')
        globalEvents.stop()
        clearInterval(pollTimer)
        push.stop()
        await Promise.allSettled(transports.map((t) => t.stop()))
        primary.release()
        log.info('plugin disposed')
      },
    }
  } catch (err) {
    primary.release()
    throw err
  }
}

export default remoteControlPlugin
