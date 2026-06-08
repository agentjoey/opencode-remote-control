import 'dotenv/config'
import { loadConfig } from './config.js'
import { getClient, checkHealth } from './opencode/client.js'
import { EventStream } from './opencode/event-stream.js'
import { createFileBackedState } from './core/state.js'
import { createRelay } from './core/relay.js'
import { createCardBus } from './core/card-bus.js'
import { startTuiSync } from './core/tui-sync.js'
import { createTelegramTransport } from './transport/telegram/index.js'
import { createWebTransport } from './transport/web/index.js'
import { startPushNotifications } from './core/push.js'
import { createLogger } from './utils/logger.js'
import type { Transport } from './transport/interface.js'

const log = createLogger('main')

async function waitForHealth(baseUrl: string): Promise<void> {
  const RETRIES = 3
  const BACKOFF = [2000, 4000, 8000]
  for (let i = 0; i < RETRIES; i++) {
    if (await checkHealth(baseUrl)) {
      log.info(`opencode healthy at ${baseUrl}`)
      return
    }
    log.warn(`opencode unhealthy (${i+1}/${RETRIES}), retry in ${BACKOFF[i]}ms`)
    await new Promise((r) => setTimeout(r, BACKOFF[i]))
  }
  throw new Error('opencode failed health check')
}

export async function runBot(): Promise<void> {
  const config = loadConfig()
  log.info(`starting, transport=${config.transport}, opencode=${config.opencodeBaseUrl}`)
  await waitForHealth(config.opencodeBaseUrl)

  const client = getClient(config.opencodeBaseUrl)
  const eventStream = new EventStream()
  eventStream.start(client)

  const state = createFileBackedState(config.statePath)
  const cardBus = createCardBus()

  if (config.transport !== 'telegram') {
    throw new Error(`unsupported TRANSPORT: ${config.transport}`)
  }

  const transport = createTelegramTransport({
    token: config.telegramBotToken,
    allowedUserIds: config.allowedUserIds,
    baseUrl: config.opencodeBaseUrl,
    client,
    eventStream,
    state,
  })

  const transports: Transport[] = [transport]

  if (config.webEnabled) {
    const webT = createWebTransport({
      host: config.webHost,
      port: config.webPort,
      client,
      eventStream,
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

  const relay = createRelay({
    cardBus,
    client,
    eventStream,
    state,
    chatTimeoutMs: config.chatTimeoutMs,
    tuiVisible: config.tuiVisible,
    baseUrl: config.opencodeBaseUrl,
  })

  for (const t of transports) {
    t.onMessage(relay)
  }

  const stopSync = startTuiSync({ eventStream, state, client })

  const stopPush = startPushNotifications({
    eventStream,
    cardBus,
    client,
  })

  process.once('SIGINT', async () => {
    eventStream.stop(); stopSync(); stopPush()
    for (const t of transports) await t.stop().catch(() => {})
  })
  process.once('SIGTERM', async () => {
    eventStream.stop(); stopSync(); stopPush()
    for (const t of transports) await t.stop().catch(() => {})
  })

  await Promise.all(transports.map((t) => t.start({ cardBus, state })))
}

if (process.argv[1]?.endsWith('dist/index.js')) {
  runBot().catch((err) => {
    log.error('fatal', err as Error)
    process.exit(1)
  })
}
