#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { writeFileSync, existsSync } from 'node:fs'
import { runInitWizard, defaultTestConnection } from './init.js'

const HELP = `
opencode-remote-control v0.6.0

USAGE:
  oprc <command>

COMMANDS:
  init          Interactive setup wizard (writes .env)
  install       Install as opencode plugin
  uninstall     Remove from opencode plugin config
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

  console.log(HELP)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
