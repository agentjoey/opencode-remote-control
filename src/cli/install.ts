import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const PLUGIN_SPEC = 'opencode-remote-control@latest'
const GLOBAL_CONFIG = join(homedir(), '.config', 'opencode', 'opencode.json')

interface InstallOptions {
  local: boolean
  yes: boolean
}

type PluginEntry = string | [string, Record<string, unknown>]

function configPath(local: boolean): string {
  return local ? join(process.cwd(), 'opencode.json') : GLOBAL_CONFIG
}

async function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise<string>((resolve) => rl.question(question, resolve))
}

function resolveSpec(options: InstallOptions): string {
  if (options.local) {
    return process.cwd()
  }
  return PLUGIN_SPEC
}

function isOurPlugin(entry: PluginEntry): boolean {
  const name = Array.isArray(entry) ? entry[0] : entry
  return name === PLUGIN_SPEC || name === process.cwd()
}

function buildPluginEntry(spec: string, configOpts: Record<string, unknown>): PluginEntry {
  return [spec, configOpts]
}

export async function runInstall(options: InstallOptions): Promise<void> {
  const target = configPath(options.local)
  const scope = options.local ? 'project' : 'global'
  const spec = resolveSpec(options)

  console.log(`\nInstalling opencode-remote-control (${scope} config)...\n`)
  console.log(`   Config: ${target}`)

  let config: Record<string, any>
  if (existsSync(target)) {
    try {
      config = JSON.parse(readFileSync(target, 'utf-8'))
    } catch {
      console.error(`Failed to parse ${target}. Ensure it is valid JSON.`)
      process.exit(1)
    }
  } else {
    config = {}
  }

  delete config.env

  const plugins: PluginEntry[] = config.plugin ?? []

  const existingIdx = plugins.findIndex(isOurPlugin)
  const existingEntry = existingIdx >= 0 ? plugins[existingIdx] : null
  const existingOpts: Record<string, unknown> =
    existingEntry && Array.isArray(existingEntry) ? (existingEntry[1] as Record<string, unknown>) : {}

  if (existingIdx >= 0 && !options.yes) {
    console.log('\nopencode-remote-control is already installed.')
    console.log('Running in update mode...\n')
  }

  let finalToken = ''
  let finalIds = ''
  let finalWeb = ''

  if (!options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })

    console.log('--- Configuration ---')

    const existingToken = (existingOpts.telegramBotToken as string) ?? process.env.TELEGRAM_BOT_TOKEN ?? ''
    const token = await ask(rl, `TELEGRAM_BOT_TOKEN [${existingToken ? '***' : 'required'}]: `)
    finalToken = token.trim() || existingToken

    const existingIds = (existingOpts.allowedUserIds as string) ?? process.env.ALLOWED_USER_IDS ?? ''
    const ids = await ask(rl, `ALLOWED_USER_IDS (comma-separated) [${existingIds || 'required'}]: `)
    finalIds = ids.trim() || existingIds

    const existingWeb = (existingOpts.webEnabled as string) ?? process.env.WEB_ENABLED ?? 'false'
    const web = await ask(rl, `Enable Web PWA? (true/false) [${existingWeb}]: `)
    finalWeb = web.trim() || existingWeb

    rl.close()

    if (!finalToken) {
      console.error('TELEGRAM_BOT_TOKEN is required.')
      process.exit(1)
    }
    if (!finalIds) {
      console.error('ALLOWED_USER_IDS is required.')
      process.exit(1)
    }
  }

  const pluginOpts: Record<string, unknown> = { ...existingOpts }
  if (finalToken) pluginOpts.telegramBotToken = finalToken
  if (finalIds) pluginOpts.allowedUserIds = finalIds
  if (finalWeb) pluginOpts.webEnabled = finalWeb

  const entry = buildPluginEntry(spec, pluginOpts)

  if (existingIdx >= 0) {
    plugins[existingIdx] = entry
  } else {
    plugins.push(entry)
  }

  config.plugin = plugins
  writeFileSync(target, JSON.stringify(config, null, 2) + '\n')

  console.log(`\nUpdated ${target}`)
  console.log(`   plugin: [["${spec}", { ... }]]`)
  console.log(`\nInstallation complete!`)
  console.log(`   Run \`opencode\` to load the plugin (Telegram bot + Web PWA auto-start).`)
  console.log(`   Check status: /rc-status inside opencode TUI.`)
  console.log(`\nTip: You can also set env vars in your shell profile or .env file:`)
  console.log(`   export TELEGRAM_BOT_TOKEN=...`)
  console.log(`   export ALLOWED_USER_IDS=...`)
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
opencode-remote-control install

USAGE:
  npx opencode-remote-control install [OPTIONS]

OPTIONS:
  --local     Install to project opencode.json (default: global ~/.config/opencode/)
  --yes, -y   Skip interactive prompts (uses existing env vars / config)
  --help, -h  Show this help

WHAT IT DOES:
  1. Adds opencode-remote-control to your opencode config plugin array
  2. Interactively prompts for TELEGRAM_BOT_TOKEN and ALLOWED_USER_IDS
  3. Writes config as plugin tuple options (SDK-native, no invalid env field)

CONFIG LOCATION:
  Global: ~/.config/opencode/opencode.json
  Project: ./opencode.json
`)
    return
  }

  await runInstall({
    local: args.includes('--local'),
    yes: args.includes('--yes') || args.includes('-y'),
  })
}

if (process.argv[1]?.endsWith('install.js') || process.argv[1]?.endsWith('install.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
