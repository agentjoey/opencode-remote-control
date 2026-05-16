import 'dotenv/config'
import { loadConfig } from './config.js'
import { getClient, checkHealth } from './opencode/client.js'
import { EventStream } from './opencode/event-stream.js'
import { createFileBackedState } from './core/state.js'
import { createRelay } from './core/relay.js'
import { createTelegramTransport } from './transport/telegram/index.js'
import { createLogger } from './utils/logger.js'

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

  if (config.transport !== 'telegram') {
    throw new Error(`unsupported TRANSPORT: ${config.transport}`)
  }

  const transport = createTelegramTransport({
    token: config.telegramBotToken,
    allowedUserId: config.allowedUserId,
    baseUrl: config.opencodeBaseUrl,
    client,
    eventStream,
    state,
  })

  const relay = createRelay({
    transport,
    client,
    eventStream,
    state,
    editThrottleMs: config.editThrottleMs,
    chatTimeoutMs: config.chatTimeoutMs,
    tuiVisible: config.tuiVisible,
  })

  transport.onMessage(relay)

  process.once('SIGINT', () => { eventStream.stop(); void transport.stop() })
  process.once('SIGTERM', () => { eventStream.stop(); void transport.stop() })

  await transport.start()
}

if (process.argv[1]?.endsWith('index.js')) {
  runBot().catch((err) => {
    log.error('fatal', err as Error)
    process.exit(1)
  })
}
