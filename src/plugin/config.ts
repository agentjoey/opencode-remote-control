import { config as dotenvConfig } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface PluginConfig {
  telegramBotToken: string
  allowedUserIds: number[]
  webEnabled: boolean
  webHost: string
  webPort: number
  webStaticRoot: string
  webCacheSize: number
  webCfAccessTeam: string
  webCfAccessAud: string
  webCfAccessDevBypass: boolean
  webCfAccessDevEmail: string
  statePath: string
  tuiVisible: boolean
  transport: string
  chatTimeoutMs: number
  baseUrl: string
}

function loadDotEnv(): void {
  const cwd = process.cwd()
  dotenvConfig({ path: resolve(cwd, '.env') })
  if (process.env.OPENCODE_PROJECT) {
    dotenvConfig({ path: resolve(process.env.OPENCODE_PROJECT, '.env'), override: false })
    dotenvConfig({ path: resolve(process.env.OPENCODE_PROJECT, '.opencode', '.env'), override: false })
  }
  if (process.env.OPENCODE_CONFIG_DIR) {
    dotenvConfig({ path: resolve(process.env.OPENCODE_CONFIG_DIR, '.env'), override: false })
  }
}

function env(key: string, optionsVal?: string): string | undefined {
  return optionsVal ?? process.env[key]
}

export function loadPluginConfig(options?: Record<string, unknown>): PluginConfig {
  loadDotEnv()

  const token = (options?.telegramBotToken as string) ?? process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN is required. Set it via opencode.json plugin options or TELEGRAM_BOT_TOKEN environment variable.',
    )
  }

  const userIdsRaw = (options?.allowedUserIds as string) ?? process.env.ALLOWED_USER_IDS ?? ''
  const ids = userIdsRaw
    .toString()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n))

  if (ids.length === 0) {
    throw new Error('ALLOWED_USER_IDS is required (comma-separated Telegram user IDs).')
  }

  return {
    telegramBotToken: token,
    allowedUserIds: ids,
    webEnabled: bool(options?.webEnabled as string) ?? process.env.WEB_ENABLED === 'true',
    webHost: env('WEB_HOST', options?.webHost as string) ?? '127.0.0.1',
    webPort: Number(options?.webPort ?? process.env.WEB_PORT ?? 7081),
    webStaticRoot: env('WEB_STATIC_ROOT', options?.webStaticRoot as string) ?? 'web/dist',
    webCacheSize: Number(options?.webCacheSize ?? process.env.WEB_SESSION_CACHE_SIZE ?? 100),
    webCfAccessTeam: env('WEB_CF_ACCESS_TEAM', options?.webCfAccessTeam as string) ?? '',
    webCfAccessAud: env('WEB_CF_ACCESS_AUD', options?.webCfAccessAud as string) ?? '',
    webCfAccessDevBypass: bool(options?.webCfAccessDevBypass as string) ?? process.env.WEB_CF_ACCESS_DEV_BYPASS === 'true',
    webCfAccessDevEmail: env('WEB_CF_ACCESS_DEV_EMAIL', options?.webCfAccessDevEmail as string) ?? 'dev@localhost',
    statePath: env('STATE_PATH', options?.statePath as string) ?? './data/state.json',
    tuiVisible: bool(options?.tuiVisible as string) ?? process.env.TUI_VISIBLE === 'true',
    transport: env('TRANSPORT', options?.transport as string) ?? 'telegram',
    chatTimeoutMs: Number(options?.chatTimeoutMs ?? process.env.CHAT_TIMEOUT_MS ?? 600000),
    baseUrl: env('OPENCODE_BASE_URL', options?.baseUrl as string) ?? 'http://localhost:4096',
  }
}

function bool(val?: string): boolean | undefined {
  if (val === undefined) return undefined
  if (val === 'true' || val === '1' || val === 'yes') return true
  if (val === 'false' || val === '0' || val === 'no') return false
  return undefined
}
