import 'dotenv/config'
import { loadConfig } from './config.js'
import { getClient, checkHealth } from './opencode/client.js'
import { EventStream } from './opencode/event-stream.js'
import { createBot } from './bot/index.js'
import { createLogger } from './utils/logger.js'

const log = createLogger('main')

const HEALTH_RETRIES = 3
const HEALTH_BACKOFF_MS = [2000, 4000, 8000]

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let i = 0; i < HEALTH_RETRIES; i++) {
    if (await checkHealth(baseUrl)) {
      log.info(`opencode healthy at ${baseUrl}`)
      return
    }
    log.warn(`opencode unhealthy (attempt ${i + 1}/${HEALTH_RETRIES}), retry in ${HEALTH_BACKOFF_MS[i]}ms`)
    await new Promise((r) => setTimeout(r, HEALTH_BACKOFF_MS[i]))
  }
  throw new Error(`opencode failed health check at ${baseUrl} after ${HEALTH_RETRIES} attempts`)
}

async function main() {
  const config = loadConfig()
  log.info(`starting bot, opencode=${config.opencodeBaseUrl}, allowedUser=${config.allowedUserId}`)

  await waitForHealth(config.opencodeBaseUrl)

  const client = getClient(config.opencodeBaseUrl)
  const eventStream = new EventStream()
  eventStream.start(client) // fire-and-forget; loop runs in background

  const bot = createBot({ config, client, eventStream })

  process.once('SIGINT', () => {
    log.info('SIGINT received')
    eventStream.stop()
    bot.stop('SIGINT')
  })
  process.once('SIGTERM', () => {
    log.info('SIGTERM received')
    eventStream.stop()
    bot.stop('SIGTERM')
  })

  // Polling with retry — keep alive on network blips
  let attempt = 0
  let conflictCount = 0
  const MAX_CONFLICT = 8
  for (;;) {
    try {
      await bot.launch()
      // bot.launch() resolves when polling stops (e.g. on bot.stop())
      log.info('bot polling ended cleanly')
      return
    } catch (err) {
      const e = err as { response?: { error_code?: number }; message?: string }
      const code = e?.response?.error_code
      if (code === 409) {
        conflictCount += 1
        if (conflictCount >= MAX_CONFLICT) {
          log.error('Telegram 409 Conflict persisted — exiting')
          process.exit(1)
        }
        log.warn(`Telegram 409 #${conflictCount}, retry in 5s`)
        await new Promise((r) => setTimeout(r, 5000))
      } else {
        attempt += 1
        const delay = Math.min(1000 * 2 ** attempt, 30000)
        log.error(`bot.launch failed (attempt ${attempt}), retry in ${delay}ms`, e?.message ?? err)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
}

main().catch((err) => {
  log.error('fatal', err as Error)
  process.exit(1)
})
