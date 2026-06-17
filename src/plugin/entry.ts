import { tool } from '@opencode-ai/plugin'
import type { Plugin } from '@opencode-ai/plugin'
import { loadPluginConfig } from './config.js'
import { createTelegramTransport, type TelegramTransport } from '../transport/telegram/index.js'
import { createWebTransport } from '../transport/web/index.js'
import { selectAuthStrategy } from '../connectivity/auth/select.js'
import { createFileBackedState } from '../core/state.js'
import { createRelay } from '../core/relay.js'
import { createOpencodeBackend } from '../core/agent/opencode-backend.js'
import { createCardBus } from '../core/card-bus.js'
import { startPushNotifications } from '../core/push.js'
import { tryBecomePrimary } from '../core/primary-election.js'
import { startGlobalEvents } from '../opencode/global-events.js'
import { listWorkspaces } from '../opencode/workspaces.js'
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

    const backend = createOpencodeBackend({ client: ctx.client, baseUrl: serverUrl })

    const relay = createRelay({
      cardBus,
      backend,
      state,
      chatTimeoutMs: config.chatTimeoutMs,
      tuiVisible: config.tuiVisible,
    })

    const tgTransport = createTelegramTransport({
      token: config.telegramBotToken,
      allowedUserIds: config.allowedUserIds,
      backend,
      state,
      baseUrl: serverUrl,
      tgChunkSoftLimit: config.tgChunkSoftLimit,
      listWorkspaces: () => listWorkspaces(ctx.client),
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
        backend,
        auth,
        staticRoot: config.webStaticRoot,
        cacheSize: config.webCacheSize,
        baseUrl: serverUrl,
        listWorkspaces: () => listWorkspaces(ctx.client),
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
    const push = startPushNotifications({ cardBus, backend, state })

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

    // Unified event dispatch. Driven primarily by the per-instance `event` hook
    // (opencode pushes events to the plugin — reliable in the worker), and
    // supplemented by the global stream for OTHER workspaces only.
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

    // The pulled `/global/event` SSE stream connects but does NOT reliably
    // deliver events inside opencode's plugin worker (verified at runtime),
    // whereas the per-instance `event` hook below — opencode PUSHING events to
    // the plugin — works. So the hook is the primary dispatch source for THIS
    // workspace; the global stream is best-effort for OTHER workspaces only
    // (directory !== our worktree), which also prevents double-processing.
    const globalEvents = startGlobalEvents({
      client: ctx.client,
      onEvent: (ev, directory) => {
        if (directory && ctx.worktree && directory !== ctx.worktree) void dispatchEvent(ev)
      },
    })

    return {
      event: async ({ event }) => {
        // opencode pushes this workspace's events here; this is the reliable
        // in-worker path that drives streaming/finalization. (The global SSE
        // stream above only supplements with other workspaces' events.)
        await dispatchEvent(event as unknown as OcEvent)
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
        notify: tool({
          description: 'Send the user a push notification (e.g. when a long task or tests finish).',
          args: { message: tool.schema.string().describe('The notification text to push to the user') },
          async execute(args: { message: string }, context: any) {
            const sid = context?.sessionID || state.getLastSessionId()
            cardBus.publish({
              kind: 'info',
              title: 'Notification',
              sections: [{ body: `🔔 ${args.message}` }],
              ...(sid ? { sessionId: sid } : {}),
            })
            return 'notification sent'
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
