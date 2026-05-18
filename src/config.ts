import { z } from 'zod'

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  ALLOWED_USER_IDS: z.string().optional().transform((v) => {
    if (!v) return undefined
    return v.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n))
  }),
  ALLOWED_USER_ID: z.string().regex(/^\d+$/).optional().transform((v) => v ? Number(v) : undefined),
  OPENCODE_BASE_URL: z.string().url().default('http://localhost:4096'),
  EDIT_THROTTLE_MS: z.string().regex(/^\d+$/).default('1000').transform(Number),
  CHAT_TIMEOUT_MS: z.string().regex(/^\d+$/).default('600000').transform(Number),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  STREAM_OUTPUT: z.string().optional().default('true').transform((v) => v === 'true'),
  TUI_VISIBLE: z.string().optional().default('true').transform((v) => v === 'true'),
  STATE_PATH: z.string().optional().default('./data/state.json'),
  TRANSPORT: z.string().optional().default('telegram'),
  SPAWN_OPENCODE: z.string().optional().default('true').transform((v) => v === 'true'),
  OPENCODE_BIN: z.string().optional().default('opencode'),
  OPENCODE_PROJECT: z.string().optional().default(process.cwd()),
  LOG_DIR: z.string().optional().default('./data/logs'),
  TOOL_CALLS_INLINE: z.string().optional().default('true').transform((v) => v === 'true'),
  WEB_ENABLED: z.string().optional().default('false').transform((v) => v === 'true'),
  WEB_HOST: z.string().optional().default('127.0.0.1'),
  WEB_PORT: z.string().regex(/^\d+$/).optional().default('7081').transform(Number),
  WEB_STATIC_ROOT: z.string().optional().default('web/dist'),
  WEB_SESSION_CACHE_SIZE: z.string().regex(/^\d+$/).optional().default('100').transform(Number),
  WEB_CF_ACCESS_TEAM: z.string().optional().default(''),
  WEB_CF_ACCESS_AUD: z.string().optional().default(''),
  WEB_CF_ACCESS_DEV_BYPASS: z.string().optional().default('false').transform((v) => v === 'true'),
  WEB_CF_ACCESS_DEV_EMAIL: z.string().optional().default('dev@localhost'),
  TG_CHUNK_SOFT_LIMIT: z.string().regex(/^\d+$/).optional().default('3500').transform(Number),
  TG_CHUNK_HARD_LIMIT: z.string().regex(/^\d+$/).optional().default('3900').transform(Number),
})

export interface Config {
  telegramBotToken: string
  allowedUserIds: number[]
  opencodeBaseUrl: string
  editThrottleMs: number
  chatTimeoutMs: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  streamOutput: boolean
  tuiVisible: boolean
  statePath: string
  transport: string
  spawnOpencode: boolean
  opencodeBin: string
  opencodeProject: string
  logDir: string
  toolCallsInline: boolean
  webEnabled: boolean
  webHost: string
  webPort: number
  webStaticRoot: string
  webCacheSize: number
  webCfAccessTeam: string
  webCfAccessAud: string
  webCfAccessDevBypass: boolean
  webCfAccessDevEmail: string
  tgChunkSoftLimit: number
  tgChunkHardLimit: number
}

export function loadConfig(): Config {
  const parsed = schema.parse(process.env)

  const ids = parsed.ALLOWED_USER_IDS ?? (parsed.ALLOWED_USER_ID !== undefined ? [parsed.ALLOWED_USER_ID] : [])
  if (ids.length === 0) {
    throw new Error('ALLOWED_USER_IDS or ALLOWED_USER_ID must be set')
  }
  if (parsed.ALLOWED_USER_ID !== undefined && !parsed.ALLOWED_USER_IDS) {
    console.warn('[config] ALLOWED_USER_ID is deprecated; use ALLOWED_USER_IDS instead')
  }

  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    allowedUserIds: ids,
    opencodeBaseUrl: parsed.OPENCODE_BASE_URL,
    editThrottleMs: parsed.EDIT_THROTTLE_MS,
    chatTimeoutMs: parsed.CHAT_TIMEOUT_MS,
    logLevel: parsed.LOG_LEVEL,
    streamOutput: parsed.STREAM_OUTPUT,
    tuiVisible: parsed.TUI_VISIBLE,
    statePath: parsed.STATE_PATH,
    transport: parsed.TRANSPORT,
    spawnOpencode: parsed.SPAWN_OPENCODE,
    opencodeBin: parsed.OPENCODE_BIN,
    opencodeProject: parsed.OPENCODE_PROJECT,
    logDir: parsed.LOG_DIR,
    toolCallsInline: parsed.TOOL_CALLS_INLINE,
    webEnabled: parsed.WEB_ENABLED,
    webHost: parsed.WEB_HOST,
    webPort: parsed.WEB_PORT,
    webStaticRoot: parsed.WEB_STATIC_ROOT,
    webCacheSize: parsed.WEB_SESSION_CACHE_SIZE,
    webCfAccessTeam: parsed.WEB_CF_ACCESS_TEAM,
    webCfAccessAud: parsed.WEB_CF_ACCESS_AUD,
    webCfAccessDevBypass: parsed.WEB_CF_ACCESS_DEV_BYPASS,
    webCfAccessDevEmail: parsed.WEB_CF_ACCESS_DEV_EMAIL,
    tgChunkSoftLimit: parsed.TG_CHUNK_SOFT_LIMIT,
    tgChunkHardLimit: parsed.TG_CHUNK_HARD_LIMIT,
  }
}
