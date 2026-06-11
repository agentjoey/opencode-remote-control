import { config as dotenvConfig } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface PluginConfig {
  telegramBotToken: string
  allowedUserIds: number[]
  webEnabled: boolean
  webHost: string
  webPort: number
  webPublicUrl: string
  webStaticRoot: string
  webCacheSize: number
  webCfAccessTeam: string
  webCfAccessAud: string
  webCfAccessDevBypass: boolean
  webCfAccessDevEmail: string
  webAuth: 'token' | 'cf-access'
  webToken: string
  statePath: string
  tuiVisible: boolean
  transport: string
  chatTimeoutMs: number
  baseUrl: string
  tgChunkSoftLimit: number
}

// Repo root resolved from this module's OWN location (<repo>/dist/plugin/config.js,
// or <repo>/src/plugin/config.ts in dev — both two levels below the root). The
// plugin is registered globally, so opencode can be launched from any folder;
// resolving .env and bundled web assets against this constant instead of cwd is
// what keeps it working regardless of the launch directory.
const PLUGIN_ROOT = (() => {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  } catch {
    return process.cwd()
  }
})()

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
  // Finally, the plugin's own install directory — works regardless of cwd.
  dotenvConfig({ path: resolve(PLUGIN_ROOT, '.env'), override: false })
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

  const webHost = env('WEB_HOST', options?.webHost as string) ?? '127.0.0.1'

  const devBypassExplicit = bool(options?.webCfAccessDevBypass as string)
  const devBypassEnv = process.env.WEB_CF_ACCESS_DEV_BYPASS

  return {
    telegramBotToken: token,
    allowedUserIds: ids,
    webEnabled: bool(options?.webEnabled as string) ?? process.env.WEB_ENABLED === 'true',
    webHost,
    webPort: Number(options?.webPort ?? process.env.WEB_PORT ?? 17081),
    webPublicUrl: env('WEB_PUBLIC_URL', options?.webPublicUrl as string) ?? '',
    webStaticRoot: env('WEB_STATIC_ROOT', options?.webStaticRoot as string) ?? resolve(PLUGIN_ROOT, 'web', 'dist'),
    webCacheSize: Number(options?.webCacheSize ?? process.env.WEB_SESSION_CACHE_SIZE ?? 100),
    webCfAccessTeam: env('WEB_CF_ACCESS_TEAM', options?.webCfAccessTeam as string) ?? '',
    webCfAccessAud: env('WEB_CF_ACCESS_AUD', options?.webCfAccessAud as string) ?? '',
    // Default OFF: a loopback bind is not a safe bypass signal when traffic
    // arrives via a tunnel (cloudflared connects from 127.0.0.1). Local dev
    // must opt in explicitly with WEB_CF_ACCESS_DEV_BYPASS=true.
    webCfAccessDevBypass: devBypassExplicit ?? (devBypassEnv !== undefined ? devBypassEnv === 'true' : false),
    webCfAccessDevEmail: env('WEB_CF_ACCESS_DEV_EMAIL', options?.webCfAccessDevEmail as string) ?? 'dev@localhost',
    webAuth: (env('WEB_AUTH', options?.webAuth as string) ?? 'token') === 'cf-access' ? 'cf-access' : 'token',
    webToken: env('WEB_TOKEN', options?.webToken as string) ?? '',
    statePath: env('STATE_PATH', options?.statePath as string) ?? './data/state.json',
    tuiVisible: bool(options?.tuiVisible as string) ?? process.env.TUI_VISIBLE !== 'false',
    transport: env('TRANSPORT', options?.transport as string) ?? 'telegram',
    chatTimeoutMs: Number(options?.chatTimeoutMs ?? process.env.CHAT_TIMEOUT_MS ?? 600000),
    baseUrl: env('OPENCODE_BASE_URL', options?.baseUrl as string) ?? '',
    tgChunkSoftLimit: Number(options?.tgChunkSoftLimit ?? process.env.TG_CHUNK_SOFT_LIMIT ?? 3500),
  }
}

function bool(val?: string): boolean | undefined {
  if (val === undefined) return undefined
  if (val === 'true' || val === '1' || val === 'yes') return true
  if (val === 'false' || val === '0' || val === 'no') return false
  return undefined
}
