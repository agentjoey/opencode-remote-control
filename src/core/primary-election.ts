import { openSync, closeSync, writeSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from '../utils/logger.js'

const log = createLogger('election')

export interface PrimaryLock {
  isPrimary: boolean
  release(): void
}

function defaultLockPath(): string {
  const dir = process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), '.opencode')
  return join(dir, 'oprc-primary.lock')
}

/** Is a process with this pid currently alive? Signal 0 = existence check. */
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function readOwner(lockPath: string): { pid: number; startedAt: number } | undefined {
  try {
    if (!existsSync(lockPath)) return undefined
    return JSON.parse(readFileSync(lockPath, 'utf-8')) as { pid: number; startedAt: number }
  } catch { return undefined }
}

function passive(): PrimaryLock {
  return { isPrimary: false, release() { /* nothing to release */ } }
}

/**
 * Elect a single PRIMARY instance via an atomic lock file. opencode 1.17 loads
 * the plugin once per workspace, but the web server and Telegram bot are global
 * singletons — exactly one instance may own them. Creating the lock with O_EXCL
 * ('wx') is the election: the writer wins, everyone else runs PASSIVE. A lock
 * whose owner pid is dead is reclaimed.
 */
export function tryBecomePrimary(lockPath = defaultLockPath()): PrimaryLock {
  try { mkdirSync(dirname(lockPath), { recursive: true }) } catch { /* ignore */ }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx') // wx = O_CREAT | O_EXCL | O_WRONLY
      writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
      closeSync(fd)
      log.info(`became PRIMARY (pid ${process.pid})`)
      let released = false
      return {
        isPrimary: true,
        release() {
          if (released) return
          released = true
          try {
            if (readOwner(lockPath)?.pid === process.pid) unlinkSync(lockPath)
          } catch { /* ignore */ }
        },
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        log.warn(`election error, running PASSIVE: ${(err as Error).message}`)
        return passive()
      }
      const owner = readOwner(lockPath)
      if (owner && pidAlive(owner.pid)) {
        log.info(`another PRIMARY alive (pid ${owner.pid}), running PASSIVE`)
        return passive()
      }
      log.info('removing stale primary lock, retrying election')
      try { unlinkSync(lockPath) } catch { /* ignore */ }
    }
  }
  return passive()
}
