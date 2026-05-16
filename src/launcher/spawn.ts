import { spawn, ChildProcess } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { createLogger } from '../utils/logger.js'

const log = createLogger('spawn')

export interface SupervisorOptions {
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  logFile: string
  restartBackoffMs?: number[]
  maxRestarts?: number
  onExit?: (code: number | null) => void
}

export interface Supervisor {
  start(): Promise<void>
  stop(): Promise<void>
  readonly pid: number | undefined
}

export function createSupervisor(opts: SupervisorOptions): Supervisor {
  const backoff = opts.restartBackoffMs ?? [2000, 4000, 8000, 16000, 30000]
  const maxRestarts = opts.maxRestarts ?? Infinity
  let child: ChildProcess | undefined
  let stopped = false
  let restarts = 0
  let logFd: number | undefined

  function spawnOnce() {
    logFd = openSync(opts.logFile, 'a')
    child = spawn(opts.command, opts.args, {
      env: { ...process.env, ...(opts.env ?? {}) },
      cwd: opts.cwd,
      stdio: ['ignore', logFd, logFd],
    })
    log.info(`spawned ${opts.command} pid=${child.pid}`)
    child.on('exit', (code) => {
      if (logFd !== undefined) { closeSync(logFd); logFd = undefined }
      log.warn(`child exited code=${code}`)
      opts.onExit?.(code)
      if (stopped || restarts >= maxRestarts) return
      const delay = backoff[Math.min(restarts, backoff.length - 1)]
      restarts += 1
      log.info(`restart in ${delay}ms (attempt ${restarts})`)
      setTimeout(spawnOnce, delay)
    })
  }

  return {
    start: async () => { stopped = false; spawnOnce() },
    stop: async () => {
      stopped = true
      if (child && !child.killed) {
        child.kill('SIGTERM')
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (child && !child.killed) child.kill('SIGKILL')
            resolve()
          }, 2000)
          child!.once('exit', () => { clearTimeout(timer); resolve() })
        })
      }
      if (logFd !== undefined) { closeSync(logFd); logFd = undefined }
    },
    get pid() { return child?.pid },
  }
}
