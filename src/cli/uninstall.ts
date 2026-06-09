import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const PLUGIN_NAME = 'opencode-remote-control'
const GLOBAL_CONFIG = join(homedir(), '.config', 'opencode', 'opencode.json')

type PluginEntry = string | [string, Record<string, unknown>]

function isOurPlugin(entry: PluginEntry): boolean {
  const name = Array.isArray(entry) ? entry[0] : entry
  return name.startsWith(PLUGIN_NAME) || name === process.cwd()
}

export async function runUninstall(local: boolean = false): Promise<void> {
  const target = local ? join(process.cwd(), 'opencode.json') : GLOBAL_CONFIG

  if (!existsSync(target)) {
    console.log('No opencode config found.')
    process.exit(1)
  }

  let config: Record<string, any>
  try {
    config = JSON.parse(readFileSync(target, 'utf-8'))
  } catch {
    console.error(`Failed to parse ${target}.`)
    process.exit(1)
  }

  const plugins: PluginEntry[] = config.plugin ?? []
  const newPlugins = plugins.filter((p) => !isOurPlugin(p))

  if (newPlugins.length === plugins.length) {
    console.log(`\n${PLUGIN_NAME} not found in ${target}`)
    return
  }

  config.plugin = newPlugins.length > 0 ? newPlugins : undefined
  if (config.plugin === undefined) delete config.plugin

  writeFileSync(target, JSON.stringify(config, null, 2) + '\n')
  console.log(`\nRemoved ${PLUGIN_NAME} from ${target}`)
  console.log('   Restart opencode to apply.')
}

export async function main(): Promise<void> {
  const local = process.argv.includes('--local')

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
opencode-remote-control uninstall

USAGE:
  npx opencode-remote-control uninstall [OPTIONS]

OPTIONS:
  --local     Uninstall from project opencode.json
  --help, -h  Show this help
`)
    return
  }

  await runUninstall(local)
}

if (process.argv[1]?.endsWith('uninstall.js') || process.argv[1]?.endsWith('uninstall.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
