/**
 * Standalone host — runs OCRC against a spawned ACP agent (kimi/gemini/…) with NO
 * opencode. This is the parallel composition root to src/plugin/entry.ts: same
 * relay + Telegram + Web transports, but the backend is an AcpBackend and events
 * arrive via `backend.onEvent` (the backend owns its stream) instead of the
 * opencode plugin `event` hook. See docs/ACP_BACKEND_DESIGN.md (Phase 2).
 *
 * Launch:  oprc host        (reads .env: TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS,
 *                            WEB_*, OCRC_ACP_CMD="kimi acp", …)
 */
import { loadPluginConfig } from '../plugin/config.js'
import { createFileBackedState } from '../core/state.js'
import { createCardBus } from '../core/card-bus.js'
import { createRelay } from '../core/relay.js'
import { startPushNotifications } from '../core/push.js'
import { createAcpBackend, type AcpPermissionRequest } from '../core/agent/acp-backend.js'
import { makeAcpConnect, parseAcpCommand } from '../core/agent/acp-connect.js'
import { createTelegramTransport } from '../transport/telegram/index.js'
import { createWebTransport } from '../transport/web/index.js'
import { selectAuthStrategy } from '../connectivity/auth/select.js'
import type { Transport } from '../transport/interface.js'
import type { AgentEvent } from '../core/agent/event.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('acp-host')

export async function main(): Promise<void> {
  // Keep the long-lived services alive through stray rejections (mirrors entry.ts).
  process.on('unhandledRejection', (r) => log.warn(`unhandledRejection absorbed: ${(r as Error)?.stack ?? String(r)}`))
  process.on('uncaughtException', (e) => log.warn(`uncaughtException absorbed: ${e?.stack ?? String(e)}`))

  const config = loadPluginConfig()
  const spawnCfg = parseAcpCommand(config.acpCommand)
  const agentId = `acp:${spawnCfg.command}`
  log.info(`standalone host starting — agent="${config.acpCommand}" (${agentId}), web=${config.webEnabled}, port=${config.webPort}`)

  const state = createFileBackedState(config.statePath)
  const cardBus = createCardBus()

  // Late-bound so the permission bridge below can reach the Telegram transport
  // (which itself needs `backend`, which needs `onPermission` — a construction cycle).
  let tgTransport: ReturnType<typeof createTelegramTransport>

  // ACP permission bridge → the SAME approve/deny UX as opencode permissions.
  // `handlePluginPermissionEvent` sends the Telegram inline buttons AND publishes
  // the Web approval card; both surfaces route the user's decision to
  // `backend.resolvePermission(sessionId, toolCallId, decision)`, which the
  // AcpBackend maps to the ACP optionId. We surface the request, then wait for
  // that decision — with a timeout so an unanswered prompt cancels the tool call
  // instead of hanging the turn.
  //
  // OCRC_ACP_AUTO_APPROVE=true bypasses the prompt and approves once (unattended
  // use). Default is interactive approval.
  const autoApprove = process.env.OCRC_ACP_AUTO_APPROVE === 'true'
  const onPermission = async (req: AcpPermissionRequest): Promise<string | null> => {
    if (autoApprove) {
      const allow = req.options.find((o) => o.kind === 'allow_once') ?? req.options.find((o) => o.kind?.startsWith('allow'))
      log.warn(`auto-approving permission: ${req.title}`)
      return allow?.optionId ?? req.options[0]?.optionId ?? null
    }
    // Surface the request on Telegram (buttons) + Web (approval card).
    tgTransport
      .handlePluginPermissionEvent({
        type: 'permission.asked',
        properties: { id: req.requestId, sessionID: req.sessionId, title: req.title },
      })
      .catch((err: unknown) => log.error('failed to surface permission', err as Error))
    // Resolution arrives out-of-band via backend.resolvePermission (Telegram
    // button callback / Web POST /api/approval). Here we only enforce a timeout.
    return new Promise<string | null>((resolve) => {
      setTimeout(() => resolve(null), config.chatTimeoutMs)
    })
  }

  const backend = createAcpBackend({
    id: agentId,
    cwd: process.cwd(),
    connect: makeAcpConnect(spawnCfg),
    onPermission,
  })

  const relay = createRelay({
    cardBus,
    backend,
    state,
    chatTimeoutMs: config.chatTimeoutMs,
    tuiVisible: false, // no local TUI in standalone mode
  })

  const push = startPushNotifications({ cardBus, backend, state })

  // The backend OWNS its event stream: drive the relay + push from onEvent.
  backend.onEvent?.((e: AgentEvent) => {
    relay.handleEvent(e).catch((err) => log.error('relay.handleEvent failed', err as Error))
    // Feed push a minimal opencode-shaped busy/idle signal for "task done" pings.
    if (e.kind === 'idle') push.handleEvent({ type: 'session.idle', properties: { sessionID: e.sessionId } } as any)
    else if (e.kind === 'part' || e.kind === 'delta') push.handleEvent({ type: 'session.status', properties: { sessionID: e.sessionId, status: { type: 'busy' } } } as any)
  })

  tgTransport = createTelegramTransport({
    token: config.telegramBotToken,
    allowedUserIds: config.allowedUserIds,
    backend,
    state,
    baseUrl: '',
    tgChunkSoftLimit: config.tgChunkSoftLimit,
  })
  const transports: Transport[] = [tgTransport]
  tgTransport.onMessage(relay)

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
    const webTransport = createWebTransport({
      host: config.webHost,
      port: config.webPort,
      backend,
      auth,
      staticRoot: config.webStaticRoot,
      cacheSize: config.webCacheSize,
      baseUrl: '',
    })
    webTransport.onMessage(relay)
    transports.push(webTransport)
  }

  await Promise.all(transports.map((t) => t.start({ cardBus, state })))
  log.info(`${transports.length} transport(s) started; ACP backend ready`)

  const dispose = async () => {
    log.info('shutting down…')
    push.stop()
    await Promise.allSettled(transports.map((t) => t.stop()))
    process.exit(0)
  }
  process.on('SIGINT', dispose)
  process.on('SIGTERM', dispose)
}
