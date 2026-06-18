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
import type { AcpPermissionRequest } from '../core/agent/acp-backend.js'
import { createBackendRegistry } from '../core/agent/registry.js'
import { buildHostBackends, parseBackendsSpec } from './host-backends.js'
import type { OcEvent } from '../core/opencode-events.js'
// (AgentEvent wiring now lives in host-backends.ts)
import { createTelegramTransport } from '../transport/telegram/index.js'
import { createWebTransport } from '../transport/web/index.js'
import { selectAuthStrategy } from '../connectivity/auth/select.js'
import type { Transport } from '../transport/interface.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('acp-host')

export async function main(): Promise<void> {
  // Keep the long-lived services alive through stray rejections (mirrors entry.ts).
  process.on('unhandledRejection', (r) => log.warn(`unhandledRejection absorbed: ${(r as Error)?.stack ?? String(r)}`))
  process.on('uncaughtException', (e) => log.warn(`uncaughtException absorbed: ${e?.stack ?? String(e)}`))

  const config = loadPluginConfig(undefined, { requireTelegram: false })
  const specs = parseBackendsSpec(config.backends, config.acpCommand)
  const telegramEnabled = !!config.telegramBotToken
  if (!telegramEnabled && !config.webEnabled) {
    throw new Error('ACP host: nothing to serve — set TELEGRAM_BOT_TOKEN and/or WEB_ENABLED=true')
  }
  log.info(`standalone host starting — backends=[${specs.map((s) => s.id).join(', ')}], telegram=${telegramEnabled}, web=${config.webEnabled}, port=${config.webPort}`)

  const state = createFileBackedState(config.statePath)
  const cardBus = createCardBus()

  // Late-bound so the permission bridge below can reach the Telegram transport
  // (which itself needs `backend`, which needs `onPermission` — a construction cycle).
  // Undefined in web-only mode (no Telegram token).
  let tgTransport: ReturnType<typeof createTelegramTransport> | undefined

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
    // Surface the request. With Telegram, handlePluginPermissionEvent sends the
    // inline buttons AND publishes the Web approval card; web-only mode publishes
    // the card directly. Either way the user's decision routes to resolvePermission.
    if (tgTransport) {
      tgTransport
        .handlePluginPermissionEvent({
          type: 'permission.asked',
          properties: { id: req.requestId, sessionID: req.sessionId, title: req.title },
        })
        .catch((err: unknown) => log.error('failed to surface permission', err as Error))
    } else {
      cardBus.publish({ kind: 'approval', sessionId: req.sessionId, title: req.title, args: { options: req.options }, requestId: req.requestId })
    }
    // Resolution arrives out-of-band via backend.resolvePermission (Telegram
    // button callback / Web POST /api/approval). Here we only enforce a timeout.
    return new Promise<string | null>((resolve) => {
      setTimeout(() => resolve(null), config.chatTimeoutMs)
    })
  }

  // Build every backend (spawning opencode server(s) + ACP agents) and wire each
  // one's event source to the relay below.
  const built = await buildHostBackends(specs, { cwd: process.cwd(), onAcpPermission: onPermission })
  const registry = createBackendRegistry({
    backends: built.backends,
    state,
    primaryId: built.backends.find((b) => b.id === 'opencode')?.id,
  })

  const relay = createRelay({
    cardBus,
    registry,
    state,
    chatTimeoutMs: config.chatTimeoutMs,
    tuiVisible: false, // no local TUI in standalone mode
  })

  // push needs a backend for the finish-summary history read; the primary backend
  // is a best-effort source (wrong-backend reads for other sessions degrade to no
  // summary, which the caller tolerates).
  const push = startPushNotifications({ cardBus, backend: registry.get(registry.primaryId())!, state })

  // opencode permission events arrive on the SSE stream → forward to the same
  // approval UX (Telegram buttons + Web card). Web-only: publish the card directly.
  const onOpencodePermission = (ev: OcEvent) => {
    if (tgTransport) {
      tgTransport.handlePluginPermissionEvent({ type: ev.type!, properties: (ev as any).properties })
        .catch((err: unknown) => log.error('opencode permission surface failed', err as Error))
    } else {
      const p = (ev as any).properties ?? {}
      if (ev.type === 'permission.asked' && p.id && p.sessionID) {
        cardBus.publish({ kind: 'approval', sessionId: p.sessionID, title: p.title ?? 'Permission', args: p.args ?? {}, requestId: p.id })
      }
    }
  }
  const disposeBackends = built.wire(relay, push, onOpencodePermission)

  const transports: Transport[] = []
  if (telegramEnabled) {
    tgTransport = createTelegramTransport({
      token: config.telegramBotToken,
      allowedUserIds: config.allowedUserIds,
      // Telegram is single-backend for now (piece 6 migrates it to the registry):
      // it drives the primary backend / pinned session.
      backend: registry.get(registry.primaryId())!,
      state,
      baseUrl: '',
      tgChunkSoftLimit: config.tgChunkSoftLimit,
    })
    tgTransport.onMessage(relay)
    transports.push(tgTransport)
  }

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
      registry,
      auth,
      staticRoot: config.webStaticRoot,
      cacheSize: config.webCacheSize,
      baseUrl: '',
    })
    webTransport.onMessage(relay)
    transports.push(webTransport)
  }

  await Promise.all(transports.map((t) => t.start({ cardBus, state })))
  log.info(`${transports.length} transport(s) started; backends=[${registry.list().map((b) => b.id).join(', ')}]`)

  const dispose = async () => {
    log.info('shutting down…')
    push.stop()
    await disposeBackends()
    await Promise.allSettled(transports.map((t) => t.stop()))
    process.exit(0)
  }
  process.on('SIGINT', dispose)
  process.on('SIGTERM', dispose)
}
