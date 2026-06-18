#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInitWizard, defaultTestConnection } from './init.js'

const VERSION = (() => {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json')
    return (JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }).version
  } catch {
    return 'unknown'
  }
})()

const HELP = `
opencode-remote-control v${VERSION}

USAGE:
  oprc <command>

COMMANDS:
  init          Interactive setup wizard (writes .env)
  install       Install as opencode plugin
  uninstall     Remove from opencode plugin config
  pair          Show QR + URL to pair a device
  host          Run standalone against an ACP agent (no opencode; OCRC_ACP_CMD)
  --help, -h    Show this help
`

async function main() {
  const cmd = process.argv[2]

  if (cmd === 'init') {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const deps = {
      ask: (q: string) => new Promise<string>((resolve) => rl.question(q, resolve)),
      writeFile: (p: string, c: string) => writeFileSync(p, c),
      exists: (p: string) => existsSync(p),
      testConnection: defaultTestConnection,
      cwd: process.cwd(),
    }
    await runInitWizard(deps)
    rl.close()
    return
  }

  if (cmd === 'install') {
    await import('./install.js').then((m) => m.main(process.argv.slice(3)))
    return
  }

  if (cmd === 'uninstall') {
    await import('./uninstall.js').then((m) => m.main())
    return
  }

  if (cmd === 'pair') {
    await import('./pair.js').then((m) => m.main())
    return
  }

  if (cmd === 'host') {
    await import('./host.js').then((m) => m.main())
    return
  }

  console.log(HELP)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
