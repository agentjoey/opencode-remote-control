# Phase 6 Implementation Plan — Plugin Registry Migration

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate opencode-remote-control from standalone sidecar to openCode Plugin Registry. One `npx install`, then auto-start with opencode.

**Architecture:** Add `src/plugin/` entry point exporting `Plugin` function. Adapt relay and transports to work without `EventStream` (using opencode event hook). Add `install`/`uninstall` CLI. Keep legacy `src/index.ts` for backward compatibility.

**Tech Stack:** TypeScript 5.4, Node 20 (dev) / Bun (runtime via opencode), `@opencode-ai/plugin`, `@opencode-ai/sdk`, Telegraf v4, Hono v4, Vitest.

**Reference:** `docs/superpowers/specs/2026-05-31-phase6-plugin-migration-design.md` for design rationale.

---

## Task 1: Add dependencies + package.json reconfiguration

**Files:**
- Modify: `package.json`
- Create: `tsconfig.plugin.json` (if needed)

- [ ] **Step 1: Add @opencode-ai/plugin + update exports**

```jsonc
// package.json — add to dependencies
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.1.12",
    // ... existing deps unchanged
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./plugin": {
      "import": "./dist/plugin/entry.js",
      "types": "./dist/plugin/entry.d.ts"
    },
    "./install": {
      "import": "./dist/cli/install.js",
      "types": "./dist/cli/install.d.ts"
    },
    "./uninstall": {
      "import": "./dist/cli/uninstall.js",
      "types": "./dist/cli/uninstall.d.ts"
    }
  }
}
```

- [ ] **Step 2: Remove `engines.node` restriction (Bun compatibility)**

Bun runs this, not Node. Remove `"engines": {"node": ">=20.0.0"}`.

- [ ] **Step 3: Verify build**

```
npm run build    # tsc should compile new exports
npx tsc --noEmit # clean
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add @opencode-ai/plugin dep, configure plugin exports"
```

---

## Task 2: Create Plugin entry point

**Files:**
- Create: `src/plugin/entry.ts`
- Create: `src/plugin/config.ts`

- [ ] **Step 1: Create plugin config loader**

```typescript
// src/plugin/config.ts

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
}

export function loadPluginConfig(): PluginConfig {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required (set in opencode.json env or shell)')

  const userIdsStr = process.env.ALLOWED_USER_IDS ?? ''
  const ids = userIdsStr.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => Number.isFinite(n))
  if (ids.length === 0) throw new Error('ALLOWED_USER_IDS is required')

  return {
    telegramBotToken: token,
    allowedUserIds: ids,
    webEnabled: process.env.WEB_ENABLED === 'true',
    webHost: process.env.WEB_HOST ?? '127.0.0.1',
    webPort: Number(process.env.WEB_PORT ?? 7081),
    webStaticRoot: process.env.WEB_STATIC_ROOT ?? 'web/dist',
    webCacheSize: Number(process.env.WEB_SESSION_CACHE_SIZE ?? 100),
    webCfAccessTeam: process.env.WEB_CF_ACCESS_TEAM ?? '',
    webCfAccessAud: process.env.WEB_CF_ACCESS_AUD ?? '',
    webCfAccessDevBypass: process.env.WEB_CF_ACCESS_DEV_BYPASS === 'true',
    webCfAccessDevEmail: process.env.WEB_CF_ACCESS_DEV_EMAIL ?? 'dev@localhost',
    statePath: process.env.STATE_PATH ?? './data/state.json',
    tuiVisible: process.env.TUI_VISIBLE === 'true',
    transport: process.env.TRANSPORT ?? 'telegram',
    chatTimeoutMs: Number(process.env.CHAT_TIMEOUT_MS ?? 600000),
  }
}
```

- [ ] **Step 2: Create plugin entry**

See `src/plugin/entry.ts` — export `remoteControlPlugin: Plugin`:
- async init function that starts transports + relay
- returns `{ event, tool }` hooks

Key differences from `src/index.ts`:
- `ctx.client` instead of `getClient(baseUrl)`
- No `waitForHealth()` — plugin runs inside opencode
- No `checkHealth()` — not needed
- No `EventStream` — events come from hook
- No SIGINT/SIGTERM handling — opencode manages lifecycle
- Transport constructors adapted (no baseUrl, no eventStream param)

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: clean for new files.

- [ ] **Step 4: Commit**

```bash
git add src/plugin/entry.ts src/plugin/config.ts
git commit -m "feat(plugin): add Plugin entry point and config loader"
```

---

## Task 3: Adapt relay for event-hook mode

**Files:**
- Modify: `src/core/relay.ts`

- [ ] **Step 1: Add `handleEvent()` method**

Currently relay.ts uses `EventStream.onEvent()` internally. Add a new public method:

```typescript
// src/core/relay.ts — new method

export interface Relay {
  // ... existing interface
  handleEvent(event: { type: string; properties?: Record<string, unknown> }): Promise<void>
}

export function createRelay(deps: RelayDeps): Relay {
  // ... existing implementation

  async function handleEvent(event: { type: string; properties?: Record<string, unknown> }) {
    const props = event.properties ?? {}
    switch (event.type) {
      case 'session.idle':
        // Publish session.idle to CardBus
        cardBus.publish({
          kind: 'status',
          sessionId: extractSessionId(props),
          text: event.type,
        })
        break
      case 'session.error':
        cardBus.publish({
          kind: 'error',
          sessionId: extractSessionId(props),
          text: String(props.error ?? props.message ?? 'Unknown error'),
        })
        break
      case 'message.part.updated':
        // Delegate to existing accumulator logic
        await processPartUpdated(event)
        break
      case 'message.updated':
        await processMessageUpdated(event)
        break
      case 'permission.asked':
        await processPermission(event)
        break
      case 'permission.replied':
        await processPermissionReply(event)
        break
      // ... other events
    }
  }

  return { handleEvent, /* ...existing methods */ }
}
```

- [ ] **Step 2: Adapt relay constructor**

Remove `eventStream` and `baseUrl` from `RelayDeps` (make optional):

```typescript
export interface RelayDeps {
  cardBus: CardBus
  client: OpencodeClient
  eventStream?: EventStream   // optional — only for legacy mode
  state: SessionState
  chatTimeoutMs: number
  tuiVisible: boolean
  baseUrl?: string             // optional — only for legacy mode
}
```

Legacy path: existing `eventStream.onEvent()` subscriptions stay unchanged.
Plugin path: `relay.handleEvent()` is called directly from plugin event hook.

- [ ] **Step 3: Verify existing tests still pass**

```
npm test
```
Expected: all 144 tests pass (legacy mode unchanged).

- [ ] **Step 4: Verify tsc**

```
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/relay.ts
git commit -m "feat(relay): add handleEvent() for plugin event-hook mode"
```

---

## Task 4: Adapt transports for plugin mode

**Files:**
- Modify: `src/transport/telegram/index.ts`
- Modify: `src/transport/web/index.ts`

- [ ] **Step 1: Telegram transport — remove baseUrl and eventStream deps**

Current: `createTelegramTransport({ token, allowedUserIds, baseUrl, client, eventStream, state })`

Plugin mode changes:
- Remove `baseUrl` param (not needed, client has it)
- Remove `eventStream` param (not needed, events from hook)
- `start()`: no longer needs to wait for eventStream, just launch bot

Make both params optional with backward-compatible defaults:

```typescript
export function createTelegramTransport(cfg: {
  token: string
  allowedUserIds: number[]
  baseUrl?: string           // optional for plugin mode
  client: OpencodeClient
  eventStream?: EventStream  // optional for plugin mode
  state: SessionState
}): Transport {
  // ...
}
```

- [ ] **Step 2: Web transport — same treatment**

`createWebTransport({ host, port, client, eventStream?, cfAccess?, staticRoot?, cacheSize? })`

Make `eventStream` optional.

- [ ] **Step 3: Update src/index.ts (legacy) to pass optional params explicitly**

```typescript
// src/index.ts — legacy path still passes baseUrl + eventStream
const transport = createTelegramTransport({
  token: config.telegramBotToken,
  allowedUserIds: config.allowedUserIds,
  baseUrl: config.opencodeBaseUrl,    // legacy: still passes
  client,
  eventStream,                         // legacy: still passes
  state,
})
```

- [ ] **Step 4: Verify tests + tsc**

```
npm test && npx tsc --noEmit
```
Expected: all pass, clean.

- [ ] **Step 5: Commit**

```bash
git add src/transport/telegram/index.ts src/transport/web/index.ts src/index.ts
git commit -m "refactor(transport): make baseUrl/eventStream optional for plugin mode"
```

---

## Task 5: Wire event hook in plugin entry

**Files:**
- Modify: `src/plugin/entry.ts`

- [ ] **Step 1: Add event handler dispatch**

```typescript
// src/plugin/entry.ts

export const remoteControlPlugin: Plugin = async (ctx) => {
  // ... init transports, relay, etc.

  return {
    event: async ({ event }) => {
      const eventType = (event as any)?.type
      if (!eventType) return

      switch (eventType) {
        // Session events
        case 'session.idle':
        case 'session.error':
        case 'session.created':
        case 'session.deleted':
        case 'session.updated':
        case 'session.status':
        // Message events
        case 'message.part.updated':
        case 'message.updated':
        case 'message.part.removed':
        case 'message.removed':
        // Permission events
        case 'permission.asked':
        case 'permission.replied':
        // Command events
        case 'command.executed':
          await relay.handleEvent(event)
          break
      }
    },
    tool: { /* rc-status */ },
  }
}
```

- [ ] **Step 2: Add graceful shutdown on dispose**

Currently opencode Plugin lifecycle doesn't have an explicit `onDispose` hook. We'll rely on process signals (SIGINT/SIGTERM) for cleanup. If opencode adds a dispose hook later, migrate.

- [ ] **Step 3: Manual smoke test**

```
# Terminal A
opencode serve

# Manual: install plugin, verify Telegram bot starts and responds
```

- [ ] **Step 4: Commit**

```bash
git add src/plugin/entry.ts
git commit -m "feat(plugin): wire event hook → relay.handleEvent dispatch"
```

---

## Task 6: Create install CLI command

**Files:**
- Create: `src/cli/install.ts`
- Modify: `src/cli/index.ts` (add `install` subcommand)

- [ ] **Step 1: Create install.ts**

Reference: opencode-mobile `src/cli/install.ts` and `src/cli/opencode-config.ts`.

```typescript
// src/cli/install.ts

import { writeFileSync, existsSync, readFileSync } from 'fs'
import { createInterface } from 'readline'
import { join } from 'path'
import { homedir } from 'os'

const PLUGIN_SPEC = 'opencode-remote-control@latest'
const CONFIG_DIR = join(homedir(), '.config', 'opencode')

interface InstallOptions {
  global: boolean
  yes: boolean
  local: boolean
  help: boolean
}

export async function runInstall(options: InstallOptions): Promise<void> {
  const configPath = options.local
    ? 'opencode.json'
    : join(CONFIG_DIR, 'opencode.json')

  if (!existsSync(configPath)) {
    console.log(`Creating ${configPath}...`)
    writeFileSync(configPath, JSON.stringify({ plugin: [], env: {} }, null, 2))
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  const plugins: string[] = config.plugin ?? []

  if (plugins.includes(PLUGIN_SPEC)) {
    console.log(`✅ ${PLUGIN_SPEC} already installed in ${configPath}`)
    return
  }

  if (!options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const token = await new Promise<string>(resolve =>
      rl.question('TELEGRAM_BOT_TOKEN: ', resolve))
    const userIds = await new Promise<string>(resolve =>
      rl.question('ALLOWED_USER_IDS (comma-separated): ', resolve))
    rl.close()

    config.env = config.env ?? {}
    config.env.TELEGRAM_BOT_TOKEN = token
    config.env.ALLOWED_USER_IDS = userIds
  }

  config.plugin = [...new Set([...plugins, PLUGIN_SPEC])]
  writeFileSync(configPath, JSON.stringify(config, null, 2))

  console.log(`✅ Updated ${configPath}`)
  console.log(`   plugin: ["${PLUGIN_SPEC}"]`)
  console.log(`\n🎉 Install complete! Restart opencode to load.`)
}
```

- [ ] **Step 2: Wire into CLI**

```typescript
// src/cli/index.ts — add new subcommand

if (cmd === 'install') {
  const local = process.argv.includes('--local')
  const yes = process.argv.includes('--yes') || process.argv.includes('-y')
  await runInstall({ global: !local, local, yes, help: false })
  return
}
```

- [ ] **Step 3: Add bin entry in package.json**

```jsonc
"bin": {
  "opencode-remote-control": "dist/cli/index.js",
  "oprc": "dist/cli/index.js",
  "opencode-remote-control-install": "dist/cli/install.js"
}
```

- [ ] **Step 4: Verify tsc**

```
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/install.ts src/cli/index.ts package.json
git commit -m "feat(cli): add install command for Plugin Registry"
```

---

## Task 7: Create uninstall CLI + rc-status tool

**Files:**
- Create: `src/cli/uninstall.ts`

- [ ] **Step 1: Create uninstall.ts**

```typescript
// src/cli/uninstall.ts

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const PLUGIN_SPEC = 'opencode-remote-control@latest'
const CONFIG = join(homedir(), '.config', 'opencode', 'opencode.json')

export async function runUninstall(): Promise<void> {
  if (!existsSync(CONFIG)) {
    console.log('No opencode config found.')
    return
  }
  const config = JSON.parse(readFileSync(CONFIG, 'utf-8'))
  const plugins: string[] = config.plugin ?? []
  const newPlugins = plugins.filter(p => !p.startsWith('opencode-remote-control'))
  if (newPlugins.length === plugins.length) {
    console.log('Plugin not found in config.')
    return
  }
  config.plugin = newPlugins
  writeFileSync(CONFIG, JSON.stringify(config, null, 2))
  console.log(`✅ Removed from ${CONFIG}`)
  console.log('   Restart opencode to apply.')
}
```

- [ ] **Step 2: Wire into CLI (uninstall subcommand)**

```typescript
if (cmd === 'uninstall') {
  await runUninstall()
  return
}
```

- [ ] **Step 3: Verify tsc**

```
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/cli/uninstall.ts src/cli/index.ts
git commit -m "feat(cli): add uninstall command"
```

---

## Task 8: Update docs and tests

**Files:**
- Modify: `docs/ARCHITECTURE.md` — update "Why two processes" section
- Modify: `docs/OPS.md` — add plugin install instructions
- Modify: `README.md` — update quickstart
- Modify: `CHANGELOG.md` — add v0.6.0 entry

- [ ] **Step 1: Update ARCHITECTURE.md**

Replace "Why two processes (and not a plugin)" section with:

```markdown
## Migration to Plugin Registry (v0.6.0)

As of v0.6.0, opencode-remote-control supports **Plugin mode** as the
primary deployment method:

1. `npx opencode-remote-control install` — adds plugin to opencode config
2. `opencode` — plugin auto-starts Telegram bot + Web UI

The 2-process model is still available via `RC_MODE=legacy` for backward
compatibility. See `docs/superpowers/specs/2026-05-31-phase6-plugin-migration-design.md`
for the full migration rationale.
```

- [ ] **Step 2: Update README quickstart**

```markdown
## Quick Start

npx opencode-remote-control install
# Follow prompts for TELEGRAM_BOT_TOKEN and ALLOWED_USER_IDS
# Restart opencode — bot starts automatically

## Legacy Mode
RC_MODE=legacy node dist/index.js
```

- [ ] **Step 3: Update CHANGELOG**

```markdown
## v0.6.0-rc.1 — 2026-05-31

### Added
- **Plugin Registry mode** — `npx opencode-remote-control install` deploys
  as opencode plugin, auto-starts with `opencode`
- `src/plugin/entry.ts` — Plugin entry point exporting Plugin function
- `src/plugin/config.ts` — Plugin-mode config loader
- `src/cli/install.ts` / `src/cli/uninstall.ts` — Plugin management CLI
- `relay.handleEvent()` — Event-hook compatible event dispatch
- `@opencode-ai/plugin` dependency

### Changed
- Transport constructors: `baseUrl` and `eventStream` are now optional
  (required for legacy mode, omitted in plugin mode)
- `package.json` exports `./plugin`, `./install`, `./uninstall`

### Deprecated
- launchd deployment — replaced by Plugin auto-start
- `src/launcher/` — opencode itself is the launcher
```

- [ ] **Step 4: Verify all tests still pass**

```
npm test
```
Expected: all 144 tests pass.

- [ ] **Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md docs/OPS.md README.md CHANGELOG.md
git commit -m "docs: update for v0.6.0 Plugin Registry mode"
```

---

## Task 9: Integration test + npm publish prep

- [ ] **Step 1: Create plugin integration test**

```typescript
// tests/plugin/entry.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('plugin entry', () => {
  it('should export Plugin function', async () => {
    const mod = await import('../../src/plugin/entry.js')
    expect(mod.remoteControlPlugin).toBeDefined()
    expect(typeof mod.remoteControlPlugin).toBe('function')
  })

  it('should export default', async () => {
    const mod = await import('../../src/plugin/entry.js')
    expect(mod.default).toBe(mod.remoteControlPlugin)
  })
})
```

- [ ] **Step 2: Verify full test suite**

```
npm test && npx tsc --noEmit
```
Expected: 145+ tests pass, tsc clean.

- [ ] **Step 3: Build and verify dist**

```
npm run build
ls dist/plugin/entry.js    # should exist
ls dist/cli/install.js     # should exist
ls dist/cli/uninstall.js   # should exist
```

- [ ] **Step 4: Prep npm publish (dry run)**

```
npm pack --dry-run
```
Verify `dist/plugin/`, `dist/cli/install.js`, `dist/cli/uninstall.js` are included.

- [ ] **Step 5: Tag release**

```bash
git tag v0.6.0-rc.1
git commit -m "chore: bump version to 0.6.0-rc.1"
```

- [ ] **Step 6: npm publish**

```bash
npm publish --access public
```

---

## Task Summary

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1 | Add @opencode-ai/plugin + exports | `package.json` | 0.5h |
| 2 | Create plugin entry + config | `src/plugin/entry.ts`, `config.ts` | 2h |
| 3 | Adapt relay for event hook | `src/core/relay.ts` | 2h |
| 4 | Adapt transports (optional baseUrl/eventStream) | `src/transport/*/index.ts` | 1.5h |
| 5 | Wire event hook dispatch | `src/plugin/entry.ts` | 1h |
| 6 | Create install CLI | `src/cli/install.ts`, `index.ts` | 1.5h |
| 7 | Create uninstall CLI + rc-status tool | `src/cli/uninstall.ts` | 1h |
| 8 | Update docs | `ARCHITECTURE.md`, `OPS.md`, `README.md`, `CHANGELOG.md` | 1h |
| 9 | Integration test + npm publish | `tests/plugin/`, `package.json` | 1h |
| **Total** | | | **~11.5h** |
