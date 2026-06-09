import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'warn').toLowerCase()
  return LEVELS[raw as Level] ?? LEVELS.info
}

function logFilePath(): string {
  const dir = process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), '.opencode')
  return join(dir, 'opencode-remote-control.log')
}

let logFileReady = false
function ensureLogFile() {
  if (logFileReady) return
  try {
    const fp = logFilePath()
    mkdirSync(join(fp, '..'), { recursive: true })
    logFileReady = true
  } catch {
    // best effort — if we can't create the dir, fall back to console
  }
}

function format(level: Level, mod: string, msg: string, extra: unknown[]): string {
  const ts = new Date().toISOString()
  const extras = extra.length
    ? ' ' + extra.map((e) => (e instanceof Error ? e.stack ?? e.message : JSON.stringify(e))).join(' ')
    : ''
  return `[${ts}] [${level.toUpperCase()}] [${mod}] ${msg}${extras}`
}

// In-memory ring buffer of recent log lines, surfaced via GET /api/logs for
// remote diagnostics without shipping the user a log file.
const RING_SIZE = 500
const ring: string[] = []

export function recentLogs(limit = RING_SIZE): string[] {
  return ring.slice(-limit)
}

function write(level: Level, mod: string, msg: string, extra: unknown[]): void {
  const line = format(level, mod, msg, extra)

  ring.push(line)
  if (ring.length > RING_SIZE) ring.shift()

  // Write to file only — console would pollute the opencode TUI
  ensureLogFile()
  try {
    appendFileSync(logFilePath(), line + '\n')
  } catch {
    // fallback to stderr if file writing fails
    if (level === 'error' || level === 'warn') console.error(line)
  }
}

export function createLogger(mod: string) {
  return {
    debug: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.debug) write('debug', mod, msg, extra)
    },
    info: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.info) write('info', mod, msg, extra)
    },
    warn: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.warn) write('warn', mod, msg, extra)
    },
    error: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.error) write('error', mod, msg, extra)
    },
  }
}
