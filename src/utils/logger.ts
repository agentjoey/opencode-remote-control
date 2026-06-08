type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'warn').toLowerCase()
  return LEVELS[raw as Level] ?? LEVELS.info
}

function format(level: Level, mod: string, msg: string, extra: unknown[]): string {
  const ts = new Date().toISOString()
  const extras = extra.length
    ? ' ' + extra.map((e) => (e instanceof Error ? e.stack ?? e.message : JSON.stringify(e))).join(' ')
    : ''
  return `[${ts}] [${level.toUpperCase()}] [${mod}] ${msg}${extras}`
}

export function createLogger(mod: string) {
  return {
    debug: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.debug) console.log(format('debug', mod, msg, extra))
    },
    info: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.info) console.log(format('info', mod, msg, extra))
    },
    warn: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.warn) console.warn(format('warn', mod, msg, extra))
    },
    error: (msg: string, ...extra: unknown[]) => {
      if (currentLevel() <= LEVELS.error) console.error(format('error', mod, msg, extra))
    },
  }
}
