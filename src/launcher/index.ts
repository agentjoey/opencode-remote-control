import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { createSupervisor } from './spawn.js'
import { checkHealth } from '../opencode/client.js'
import { runBot } from '../index.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('launcher')

async function waitForHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await checkHealth(baseUrl)) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`opencode failed health check at ${baseUrl} within ${timeoutMs}ms`)
}

async function main() {
  const cfg = loadConfig()
  log.info(`launcher starting, opencode=${cfg.opencodeBaseUrl}, spawn=${cfg.spawnOpencode}`)

  mkdirSync(cfg.logDir, { recursive: true })

  const ownSupervisor =
    cfg.spawnOpencode && !(await checkHealth(cfg.opencodeBaseUrl))
      ? createSupervisor({
          command: cfg.opencodeBin,
          args: ['serve', '--port', new URL(cfg.opencodeBaseUrl).port || '4096'],
          cwd: cfg.opencodeProject,
          logFile: join(cfg.logDir, 'opencode-serve.log'),
        })
      : undefined

  if (ownSupervisor) {
    await ownSupervisor.start()
    log.info(`spawned opencode serve pid=${ownSupervisor.pid}`)
  } else {
    log.info('using external opencode serve')
  }

  await waitForHealth(cfg.opencodeBaseUrl)
  log.info('opencode healthy, starting bot')

  const shutdown = async (sig: string) => {
    log.info(`${sig} received, shutting down`)
    if (ownSupervisor) await ownSupervisor.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  await runBot()
}

main().catch((err) => {
  log.error('launcher fatal', err as Error)
  process.exit(1)
})
