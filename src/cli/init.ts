import { createInterface } from 'node:readline'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface InitDeps {
  ask(q: string): Promise<string>
  writeFile(path: string, content: string): void
  exists(path: string): boolean
  testConnection(token: string): Promise<void>
  cwd: string
}

export async function runInitWizard(deps: InitDeps): Promise<void> {
  console.log('🤖 opencode-remote-control setup wizard\n')
  console.log('Get your Telegram bot token from @BotFather.')
  console.log('Find your Telegram user ID by messaging @userinfobot.\n')

  const token = (await deps.ask('Telegram Bot Token: ')).trim()
  if (!token) {
    console.log('❌ Token is required.')
    process.exit(1)
  }

  const userId = (await deps.ask('Your Telegram User ID: ')).trim()
  if (!userId || !/^\d+$/.test(userId)) {
    console.log('❌ User ID must be numeric.')
    process.exit(1)
  }

  const spawnRaw = await deps.ask('Auto-spawn opencode serve on start? (Y/n): ')
  const spawnOpencode = !spawnRaw.trim().toLowerCase().startsWith('n')

  console.log('\n🔌 Testing connection to Telegram…')
  try {
    await deps.testConnection(token)
    console.log('✅ Bot token is valid.\n')
  } catch (err) {
    console.log(`❌ Connection failed: ${(err as Error).message}`)
    const force = await deps.ask('Continue anyway? (y/N): ')
    if (!force.trim().toLowerCase().startsWith('y')) {
      process.exit(1)
    }
  }

  const envPath = join(deps.cwd, '.env')
  if (deps.exists(envPath)) {
    const overwrite = await deps.ask('.env already exists. Overwrite? (y/N): ')
    if (!overwrite.trim().toLowerCase().startsWith('y')) {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  const lines = [
    `TELEGRAM_BOT_TOKEN=${token}`,
    `ALLOWED_USER_IDS=${userId}`,
    `SPAWN_OPENCODE=${spawnOpencode}`,
    'OPENCODE_BASE_URL=http://localhost:4096',
  ]

  deps.writeFile(envPath, lines.join('\n') + '\n')
  console.log(`✅ .env written to ${envPath}\n`)
  console.log('Next steps:')
  console.log('  npm install')
  console.log('  npm run build')
  console.log('  npm start')
  console.log('\nOr install as a background service:')
  console.log('  bash scripts/install-launchd.sh')
}

export async function defaultTestConnection(token: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.description ?? `HTTP ${res.status}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const deps: InitDeps = {
    ask: (q) => new Promise((resolve) => rl.question(q, resolve)),
    writeFile: (p, c) => writeFileSync(p, c),
    exists: (p) => existsSync(p),
    testConnection: defaultTestConnection,
    cwd: process.cwd(),
  }
  runInitWizard(deps).finally(() => rl.close())
}
