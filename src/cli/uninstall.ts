import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OPENCODE_CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), '.config', 'opencode')
const BRIDGE_FILE = join(OPENCODE_CONFIG_DIR, 'plugins', 'opencode-remote-control.js')
const GLOBAL_OPENCODE_JSON = join(OPENCODE_CONFIG_DIR, 'opencode.json')

type PluginEntry = string | [string, Record<string, unknown>]

/** Remove any legacy directory-path / package entry from opencode.json. */
function removeLegacyEntry(): boolean {
  if (!existsSync(GLOBAL_OPENCODE_JSON)) return false
  let config: Record<string, any>
  try { config = JSON.parse(readFileSync(GLOBAL_OPENCODE_JSON, 'utf-8')) } catch { return false }
  const plugins: PluginEntry[] = config.plugin ?? []
  const filtered = plugins.filter((e) => {
    const name = Array.isArray(e) ? e[0] : e
    return !(name === REPO_ROOT || name.startsWith('opencode-remote-control'))
  })
  if (filtered.length === plugins.length) return false
  if (filtered.length > 0) config.plugin = filtered
  else delete config.plugin
  writeFileSync(GLOBAL_OPENCODE_JSON, JSON.stringify(config, null, 2) + '\n')
  return true
}

export async function runUninstall(): Promise<void> {
  let removed = false

  if (existsSync(BRIDGE_FILE)) {
    rmSync(BRIDGE_FILE)
    console.log(`Removed plugin bridge: ${BRIDGE_FILE}`)
    removed = true
  }

  if (removeLegacyEntry()) {
    console.log(`Removed legacy plugin entry from ${GLOBAL_OPENCODE_JSON}`)
    removed = true
  }

  if (!removed) {
    console.log('opencode-remote-control was not installed (no bridge or config entry found).')
    return
  }

  console.log('\nUninstalled. Restart opencode to apply.')
  console.log(`(Your .env at ${join(REPO_ROOT, '.env')} was left untouched.)`)
}

export async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
opencode-remote-control uninstall (opencode 1.17+)

USAGE:
  node dist/cli/uninstall.js

WHAT IT DOES:
  - Removes the plugin bridge from ~/.config/opencode/plugins/
  - Removes any legacy directory-path entry from opencode.json
  - Leaves your .env untouched
`)
    return
  }
  await runUninstall()
}

if (process.argv[1]?.endsWith('uninstall.js') || process.argv[1]?.endsWith('uninstall.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
