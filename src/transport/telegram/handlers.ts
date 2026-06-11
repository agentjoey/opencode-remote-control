import type { Telegraf, Context } from 'telegraf'
import { Markup } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../core/state.js'
import type { CardBus } from '../../core/card-bus.js'
import { createLogger } from '../../utils/logger.js'
import { getVersionInfo } from '../../utils/version.js'
import { registerInfoCommands } from './handlers/info-commands.js'
import { listAllSessions } from '../../opencode/list-sessions.js'

const log = createLogger('handlers')

export interface HandlersDeps {
  bot: Telegraf
  client: OpencodeClient
  state: SessionState
  chatId: number
  isGenerating: () => boolean
  abortGeneration: () => void
  /** opencode server base URL (in-process plugin server). */
  baseUrl?: string
  /** Shared pending-approval map. */
  pendingApprovals: Map<string, PendingApproval>
  /** CardBus — optional, available after transport start. */
  cardBus?: CardBus
  /** Project directory where opencode.json lives, used as `directory` query param for /config endpoints. */
  opencodeProject?: string
}

interface AgentConfig {
  name: string
  model: string
  description: string
}

// All opencode API access goes through the in-process SDK client. opencode 1.17
// runs plugins in a worker thread where Bun's fetch can't reach ctx.serverUrl
// ("Unable to connect"), so raw fetch(baseUrl/...) is unusable — the client is.

/** Check health via the in-process SDK client. */
async function checkHealth(client: OpencodeClient): Promise<boolean> {
  try {
    await client.session.status()
    return true
  } catch {
    return false
  }
}

async function fetchUserAgents(client: OpencodeClient, directory?: string): Promise<AgentConfig[]> {
  const res = await client.config.get(directory ? { query: { directory } } : {})
  const data = (res.data ?? {}) as {
    agent?: Record<string, { model?: string; description?: string }>
  }
  const agents = data.agent ?? {}
  return Object.entries(agents)
    .filter(([, v]) => typeof v.model === 'string')
    .map(([name, v]) => ({
      name,
      model: v.model as string,
      description: v.description ?? '',
    }))
}

interface ProviderInfo {
  id: string
  name: string
  models: Record<string, { name: string }>
}

async function fetchProviders(client: OpencodeClient, directory?: string): Promise<ProviderInfo[]> {
  const res = await client.config.providers(directory ? { query: { directory } } : {})
  const data = (res.data ?? {}) as { providers?: ProviderInfo[] }
  return data.providers ?? []
}

/**
 * Parse a "providerID/modelID" string into the shape expected by state/relay.
 * Returns undefined if the string lacks a slash. Preserves slashes inside modelID.
 */
function parseAgentModel(modelStr: string): { providerID: string; modelID: string } | undefined {
  const idx = modelStr.indexOf('/')
  if (idx <= 0 || idx === modelStr.length - 1) return undefined
  return {
    providerID: modelStr.slice(0, idx),
    modelID: modelStr.slice(idx + 1),
  }
}


function shortPath(p: string): string {
  const cwd = process.cwd()
  if (p.startsWith(cwd + '/')) return p.slice(cwd.length + 1)
  if (p.startsWith('/')) {
    const parts = p.split('/')
    if (parts.length > 3) return '…/' + parts.slice(-3).join('/')
  }
  return p
}

interface StatusCard {
  lines: string[]
  buttons: ReturnType<typeof Markup.button.callback>[]
}

async function buildStatusCard(deps: HandlersDeps): Promise<StatusCard> {
  const healthy = await checkHealth(deps.client)
  let busyCount = 0
  let totalSessions = 0
  let totalCost = 0
  try {
    const res = await deps.client.session.status()
    const data = (res.data ?? {}) as Record<string, { type: string }>
    totalSessions = Object.keys(data).length
    busyCount = Object.values(data).filter((s) => s.type === 'busy').length
    for (const sid of Object.keys(data)) {
      const c = deps.state.getSessionCost(sid)
      if (c !== undefined) totalCost += c
    }
  } catch {
    try {
      totalSessions = ((await listAllSessions(deps.client)) as Array<{ id: string }>).length
    } catch {}
  }
  const pinnedSession = deps.state.getPinnedSessionId()
  const lastSession = deps.state.getLastSessionId()
  const tuiSession = deps.state.getTuiSelectedSession()
  const effectiveSession = pinnedSession ?? lastSession
  const currentAgent = deps.state.getCurrentAgent()
  const nextAgent = deps.state.getNextAgent()
  const nextModel = deps.state.getNextModel()

  const row = (label: string, value: string) =>
    `  <b>${label}</b>   ${value}`

  const sessionLabel = pinnedSession ? 'Bot 📌' : 'Bot'
  const lines = [
    `${healthy ? '🟢' : '🔴'}  <b>opencode</b>  ·  ${healthy ? 'healthy' : 'unreachable'}`,
    '',
    row('Sessions', `${totalSessions}  ·  ${busyCount} busy`),
    ...(totalCost > 0 ? [row('Cost', `$${totalCost.toFixed(2)} today`)] : []),
    ...(effectiveSession
      ? [row(sessionLabel, `<code>…${effectiveSession.slice(-8)}</code>${currentAgent ? `  ·  ${currentAgent}` : ''}`)]
      : []),
    ...(tuiSession && tuiSession !== effectiveSession
      ? [row('TUI', `<code>…${tuiSession.slice(-8)}</code>`)]
      : []),
    ...((nextAgent || nextModel)
      ? ['',
         `  Next ›  ${nextAgent ? `<b>${nextAgent}</b>` : '—'}  ·  ${nextModel ? `<code>${nextModel.modelID}</code>` : '—'}`]
      : []),
  ]
  const buttons: ReturnType<typeof Markup.button.callback>[] = [
    Markup.button.callback('🔄 Refresh', 'status:refresh'),
  ]
  if (deps.isGenerating()) {
    buttons.push(Markup.button.callback('⏹ Stop', 'status:abort'))
  }
  return { lines, buttons }
}

export function registerHandlers(deps: HandlersDeps): void {
  // ── Commands ──

  deps.bot.command('start', async (ctx: Context) => {
    const healthy = await checkHealth(deps.client)
    const username = ctx.from?.first_name ?? 'there'
    const nextAgent = deps.state.getNextAgent()
    const nextModel = deps.state.getNextModel()
    const lines = [
      `👋  <b>Hi ${username}</b>`,
      '',
      `opencode  ${healthy ? '🟢 ready' : '🔴 unreachable'}`,
      'Send any message to relay it into opencode.',
      '',
      '<b>Commands</b>',
      '  /status    Health + current session',
      '  /sessions  List all sessions',
      '  /agent     Set next-message agent',
      '  /model     Set next-message model',
      '  /files     Files touched this session',
      '  /diff      Pending git diff',
      '  /todo      Session todo list',
      '  /context   Tokens + cost + model',
      '  /abort     Stop generation',
    ]
    if (nextAgent || nextModel) {
      lines.push('')
      if (nextAgent) lines.push(`<i>Next agent: ${nextAgent}</i>`)
      if (nextModel) lines.push(`<i>Next model: ${nextModel.modelID}</i>`)
    }
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Status', 'status:refresh')],
      ]),
    })
  })

  deps.bot.command('status', async (ctx: Context) => {
    const { lines, buttons } = await buildStatusCard(deps)
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([buttons]),
    })
  })

  deps.bot.command('sessions', async (ctx: Context) => {
    try {
      const sessions = await listAllSessions(deps.client) as Array<{ id: string; title?: string; time?: { created?: number } }>
      if (sessions.length === 0) {
        await ctx.reply('No sessions.', { parse_mode: 'HTML' })
        return
      }
      const pinned = deps.state.getLastSessionId()
      const lines: string[] = ['<b>📋 Sessions</b>', '']
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i]
        const when = s.time?.created
          ? new Date(s.time.created).toLocaleString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })
          : 'unknown'
        const pinEmoji = s.id === pinned ? '📌 ' : ''
        lines.push(`${i + 1}. ${pinEmoji}<code>…${s.id.slice(-8)}</code>`)
        lines.push(`   ${s.title ?? 'Untitled'} · ${when}`)
        lines.push('')
      }
      if (pinned) {
        lines.push(`<i>📌 Pinned: …${pinned.slice(-8)}</i>`)
      }
      const rows = sessions.map(s => [
        Markup.button.callback(`📌 Pin ${s.id.slice(-6)}`, `session:pin:${s.id}`),
      ])
      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(rows),
      })
    } catch (err) {
      log.error('failed to list sessions', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('session', async (ctx: Context) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : ''
    const args = text ? text.split(' ').slice(1)[0]?.trim() : undefined
    if (args && args.length > 0) {
      deps.state.setPinnedSessionId(args)
      await ctx.reply(
        `<b>📌 Pinned</b>\n\n<code>${args}</code>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Unpin', 'session:unpin')],
          ]),
        },
      )
      return
    }
    const pinned = deps.state.getPinnedSessionId()
    if (!pinned) {
      await ctx.reply(
        'No session pinned. Use <code>/session &lt;id&gt;</code> or pick from /sessions.',
        { parse_mode: 'HTML' },
      )
      return
    }
    await ctx.reply(
      `<b>📌 Pinned session</b>\n\n<code>${pinned}</code>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Unpin', 'session:unpin')],
        ]),
      },
    )
  })

  deps.bot.command('files', async (ctx: Context) => {
    const last = deps.state.getLastSessionId()
    if (!last) {
      await ctx.reply(
        '<b>📁 Files</b>\n\nNo session yet. Send a message first.',
        { parse_mode: 'HTML' },
      )
      return
    }

    try {
      const result = await deps.client.session.messages({ path: { id: last } })
      const msgs = (result.data ?? []) as Array<{
        parts?: Array<{ type?: string; tool?: string; files?: string[]; state?: { input?: { filePath?: string } } }>
      }>

      interface FileOp { emoji: string; path: string }
      const fileOps = new Map<string, string>()
      const fileEmoji: Record<string, string> = {
        read: '📖', write: '🆕', edit: '✏️',
      }

      for (const msg of msgs) {
        for (const part of (msg.parts ?? [])) {
          if (part.type === 'tool' && part.tool && fileEmoji[part.tool]) {
            const fp = part.state?.input?.filePath
            if (fp) fileOps.set(fp, fileEmoji[part.tool])
          }
          if (part.type === 'patch' && part.files) {
            for (const f of part.files) {
              if (!fileOps.has(f)) fileOps.set(f, '✏️')
            }
          }
        }
      }

      const shortId = last.slice(-8)
      if (fileOps.size === 0) {
        await ctx.reply(
          `<b>📁 Files — …${shortId}</b>\n\nNo file operations recorded.`,
          { parse_mode: 'HTML' },
        )
        return
      }

      const MAX = 15
      const entries = [...fileOps.entries()]
      const shown = entries.slice(0, MAX)
      const lines = [
        `<b>📁 Files — …${shortId}</b>`,
        '',
        ...shown.map(([p, emoji]) => `${emoji}  <code>${shortPath(p)}</code>`),
      ]
      if (entries.length > MAX) {
        lines.push(`\n…and ${entries.length - MAX} more`)
      }
      lines.push('', `<i>${entries.length} file operation${entries.length > 1 ? 's' : ''}</i>`)

      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
    } catch (err) {
      log.error('failed to fetch files', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('agent', async (ctx: Context) => {
    try {
      const agents = await fetchUserAgents(deps.client, deps.opencodeProject)
      if (agents.length === 0) {
        await ctx.reply(
          '🤖  <b>Agent</b>\n\nNo agents configured. Add them in <code>opencode.jsonc</code>.',
          { parse_mode: 'HTML' },
        )
        return
      }
      const nextAgent = deps.state.getNextAgent()
      const lines = ['🤖  <b>Agent</b>', '']
      for (const a of agents) {
        const active = a.name === nextAgent
        const modelShort = a.model.split('/').pop() ?? a.model
        const marker = active ? '✓' : '  '
        const name = active ? `<b>${a.name}</b>` : a.name
        const desc = a.description ? `  <i>${a.description}</i>` : ''
        lines.push(`${marker}  ${name}  <code>${modelShort}</code>${desc}`)
      }
      if (nextAgent) lines.push('', `<i>Active override: ${nextAgent}</i>`)
      const rows = agents.map(a => [Markup.button.callback(a.name, `agent:set:${a.name}`)])
      rows.push([Markup.button.callback('✕ Clear override', 'agent:clear')])
      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(rows),
      })
    } catch (err) {
      log.error('failed to list agents', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('model', async (ctx: Context) => {
    try {
      const providers = await fetchProviders(deps.client, deps.opencodeProject)
      if (providers.length === 0) {
        await ctx.reply('<b>⚙️ Model</b>\n\nNo models configured.', { parse_mode: 'HTML' })
        return
      }

      const nextModel = deps.state.getNextModel()
      const lines = ['<b>⚙️ Model — Select provider</b>', '']
      const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = []

      for (const p of providers) {
        const count = Object.keys(p.models ?? {}).length
        const hasSelected = nextModel?.providerID === p.id
        const marker = hasSelected ? '●' : '▸'
        lines.push(`${marker} <b>${p.name}</b>  ·  ${count} model${count !== 1 ? 's' : ''}`)
        rows.push([Markup.button.callback(p.name, `model:pick:${p.id}`)])
      }

      if (nextModel) {
        lines.push('', `<i>Current override: ${nextModel.providerID}/${nextModel.modelID}</i>`)
      }
      rows.push([Markup.button.callback('✕ Clear', 'model:clear')])

      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(rows),
      })
    } catch (err) {
      log.error('failed to list models', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('current', async (ctx: Context) => {
    const last = deps.state.getLastSessionId()
    if (!last) {
      await ctx.reply(
        '<b>📍 No session</b>\n\nSend a message to start one.',
        { parse_mode: 'HTML' },
      )
      return
    }
    await ctx.reply(
      `<b>📍 Current session</b>\n\n<code>${last}</code>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Unpin', 'session:unpin')],
        ]),
      },
    )
  })

  deps.bot.command('abort', async (ctx: Context) => {
    const last = deps.state.getLastSessionId()
    if (!last) {
      await ctx.reply('No session to abort.', { parse_mode: 'HTML' })
      return
    }
    deps.abortGeneration()
    try {
      await deps.client.session.abort({ path: { id: last } })
      await ctx.reply(`<b>🛑 Aborted</b>\n\n<code>…${last.slice(-8)}</code>`, { parse_mode: 'HTML' })
    } catch (err) {
      await ctx.reply(`❌ Abort failed: ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('version', async (ctx: Context) => {
    const { version, commit, uptime, node } = getVersionInfo()
    await ctx.reply(
      [
        `<b>opencode-remote-control</b>  v${version}`,
        `Commit: <code>${commit}</code>`,
        `Uptime: ${uptime}`,
        `Node: ${node}`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  })

  deps.bot.command('help', async (ctx: Context) => {
    await ctx.reply(
      [
        '<b>🤖 opencode-remote-control</b>',
        '',
        '<b>Commands:</b>',
        '  /start   Handshake + health',
        '  /status  Server health + session',
        '  /sessions List all sessions',
        '  /session Pin a session',
        '  /files   Files touched in last session',
        '  /diff    Pending git diff',
        '  /todo    Session todo list',
        '  /context Tokens + cost + model',
        '  /agent   Set next agent',
        '  /model   Set next model',
        '  /current Last session used',
        '  /abort   Stop generation',
        '  /version Bot version + uptime',
        '  /help    This message',
        '',
        'Send any text to relay it into opencode.',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Check status', 'status:refresh')],
        ]),
      },
    )
  })

  deps.bot.telegram
    .setMyCommands([
      { command: 'start', description: 'Handshake and health' },
      { command: 'status', description: 'Server + last session' },
      { command: 'sessions', description: 'List all sessions' },
      { command: 'session', description: 'Pin a session' },
      { command: 'files', description: 'Files touched in last session' },
      { command: 'diff', description: 'Pending git diff' },
      { command: 'todo', description: 'Session todo list' },
      { command: 'context', description: 'Tokens + cost + model' },
      { command: 'agent', description: 'Set next agent' },
      { command: 'model', description: 'Set next model' },
      { command: 'current', description: 'Last session used' },
      { command: 'abort', description: 'Stop the current generation' },
      { command: 'version', description: 'Bot version + uptime' },
      { command: 'help', description: 'Show help' },
    ])
    .catch((err) => log.warn('setMyCommands failed', err))

  // ── Callbacks ──

  deps.bot.action(/^session:pin:(.+)$/, async (ctx) => {
    const id = ctx.match[1]
    deps.state.setPinnedSessionId(id)
    await ctx.answerCbQuery(`Pinned ${id.slice(-8)}`)
    try {
      await ctx.editMessageText(
        `<b>📌 Pinned</b>\n\n<code>${id}</code>`,
        { parse_mode: 'HTML' },
      )
    } catch (err) {
      const msg = (err as Error).message
      if (!msg.includes('message is not modified')) log.warn('session:pin edit failed', msg)
    }
  })

  deps.bot.action('session:unpin', async (ctx) => {
    deps.state.setPinnedSessionId(undefined)
    await ctx.answerCbQuery('Unpinned')
    try {
      await ctx.editMessageText(
        '<b>📌 Session unpinned</b>\n\nMessages will use the most recently active session.',
        { parse_mode: 'HTML' },
      )
    } catch (err) {
      const msg = (err as Error).message
      if (!msg.includes('message is not modified')) log.warn('session:unpin edit failed', msg)
    }
  })

  deps.bot.action('status:refresh', async (ctx) => {
    const { lines, buttons } = await buildStatusCard(deps)
    try {
      await ctx.editMessageText(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([buttons]),
      })
      await ctx.answerCbQuery('Refreshed')
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('message is not modified')) {
        await ctx.answerCbQuery('Status is unchanged')
      } else {
        log.warn('status:refresh edit failed', msg)
        await ctx.answerCbQuery('Failed to refresh')
      }
    }
  })

  deps.bot.action('status:abort', async (ctx) => {
    deps.abortGeneration()
    const last = deps.state.getLastSessionId()
    if (last) {
      try {
        await deps.client.session.abort({ path: { id: last } })
      } catch {}
    }
    await ctx.answerCbQuery('Aborting…')
    try {
      await ctx.editMessageText('🛑 Generation aborted.', { parse_mode: 'HTML' })
    } catch (err) {
      const msg = (err as Error).message
      if (!msg.includes('message is not modified')) log.warn('status:abort edit failed', msg)
    }
  })

  deps.bot.action(/^agent:set:(.+)$/, async (ctx) => {
    const name = ctx.match[1]
    log.info(`agent:set callback: ${name}`)
    deps.state.setNextAgent(name)
    // Sync model to whatever this agent is bound to in opencode.jsonc, so the
    // user doesn't end up running a new agent against a stale /model override.
    let modelSuffix = ''
    try {
      const agents = await fetchUserAgents(deps.client, deps.opencodeProject)
      const a = agents.find((x) => x.name === name)
      const parsed = a ? parseAgentModel(a.model) : undefined
      if (parsed) {
        deps.state.setNextModel(parsed)
        modelSuffix = ` · <code>${parsed.modelID}</code>`
      }
    } catch (err) {
      log.warn(`agent:set model sync failed: ${(err as Error).message}`)
    }
    await ctx.answerCbQuery(`Agent → ${name}`)
    try {
      await ctx.editMessageText(
        `<b>🤖 Agent set</b>\n\nNext message will use <b>${name}</b>${modelSuffix}.`,
        { parse_mode: 'HTML' },
      )
    } catch (err) {
      const msg = (err as Error).message
      if (!msg.includes('message is not modified')) log.warn('agent:set edit failed', msg)
    }
  })

  deps.bot.action('agent:clear', async (ctx) => {
    deps.state.setNextAgent(undefined)
    await ctx.answerCbQuery('Agent cleared')
    try {
      await ctx.editMessageText(
        '<b>🤖 Agent cleared</b>\n\nNext message will use the default agent.',
        { parse_mode: 'HTML' },
      )
    } catch (err) {
      const msg = (err as Error).message
      if (!msg.includes('message is not modified')) log.warn('agent:clear edit failed', msg)
    }
  })

  deps.bot.action(/^model:set:([^:]+):(.+)$/, async (ctx) => {
    const providerID = ctx.match[1]
    const modelID = ctx.match[2]
    log.info(`model:set callback: provider=${providerID} model=${modelID}`)
    const parsed = { providerID, modelID }
    deps.state.setNextModel(parsed)
    await ctx.answerCbQuery(`Model → ${modelID}`)
    try {
      await ctx.editMessageText(
        `<b>⚙️ Model set</b>\n\nNext message will use <code>${providerID}/${modelID}</code>.`,
        { parse_mode: 'HTML' },
      )
    } catch (err) {
      const msg = (err as Error).message
      if (!msg.includes('message is not modified')) log.warn('model:set edit failed', msg)
    }
  })

  deps.bot.action('model:clear', async (ctx) => {
    deps.state.setNextModel(undefined)
    await ctx.answerCbQuery('Model cleared')
    try {
      await ctx.editMessageText(
        '<b>⚙️ Model cleared</b>\n\nNext message will use the default model.',
        { parse_mode: 'HTML' },
      )
    } catch (err) {
      const msg = (err as Error).message
      if (!msg.includes('message is not modified')) log.warn('model:clear edit failed', msg)
    }
  })

  // Step 2: pick a specific model after selecting a provider
  deps.bot.action(/^model:pick:(.+)$/, async (ctx) => {
    const providerID = ctx.match[1]
    try {
      const providers = await fetchProviders(deps.client, deps.opencodeProject)
      const provider = providers.find(p => p.id === providerID)
      if (!provider || Object.keys(provider.models ?? {}).length === 0) {
        await ctx.answerCbQuery('No models for this provider')
        return
      }

      const nextModel = deps.state.getNextModel()
      const lines = [
        `<b>⚙️ Model — ${provider.name}</b>`,
        '',
      ]
      const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = []

      for (const [id, m] of Object.entries(provider.models ?? {})) {
        const sel = nextModel?.providerID === providerID && nextModel?.modelID === id ? '●' : '○'
        lines.push(`${sel} ${m.name ?? id}`)
        rows.push([Markup.button.callback(m.name ?? id, `model:set:${providerID}:${id}`)])
      }

      rows.push([Markup.button.callback('◀ Back', 'model:back')])

      await ctx.editMessageText(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(rows),
      })
      await ctx.answerCbQuery()
    } catch (err) {
      log.error('model:pick failed', err as Error)
      await ctx.answerCbQuery('Failed to load models')
    }
  })

  // Back to provider list
  deps.bot.action('model:back', async (ctx) => {
    try {
      const providers = await fetchProviders(deps.client, deps.opencodeProject)
      const nextModel = deps.state.getNextModel()
      const lines = ['<b>⚙️ Model — Select provider</b>', '']
      const rows: Array<Array<ReturnType<typeof Markup.button.callback>>> = []

      for (const p of providers) {
        const count = Object.keys(p.models ?? {}).length
        const hasSelected = nextModel?.providerID === p.id
        const marker = hasSelected ? '●' : '▸'
        lines.push(`${marker} <b>${p.name}</b>  ·  ${count} model${count !== 1 ? 's' : ''}`)
        rows.push([Markup.button.callback(p.name, `model:pick:${p.id}`)])
      }

      if (nextModel) {
        lines.push('', `<i>Current override: ${nextModel.providerID}/${nextModel.modelID}</i>`)
      }
      rows.push([Markup.button.callback('✕ Clear', 'model:clear')])

      await ctx.editMessageText(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(rows),
      })
      await ctx.answerCbQuery()
    } catch (err) {
      log.error('model:back failed', err as Error)
      await ctx.answerCbQuery('Failed')
    }
  })

  deps.bot.action(/^relay:abort:(.+)$/, async (ctx) => {
    const sessionId = ctx.match[1]
    const ac = deps.state.getActiveAbort(sessionId)
    if (ac) {
      ac.abort()
      await ctx.answerCbQuery('Aborting…')
      try {
        await ctx.editMessageText('🛑 Generation aborted.', { parse_mode: 'HTML' })
      } catch {}
    } else {
      await ctx.answerCbQuery('No active generation for this session.')
    }
  })

  deps.bot.action('card:dismiss', async (ctx) => {
    await ctx.answerCbQuery()
    await ctx.deleteMessage().catch(() => {})
  })

  // ── Info commands (split to separate file) ──
  registerInfoCommands({ bot: deps.bot, client: deps.client, state: deps.state })

  // ── Approval callbacks — always registered so buttons work in both modes ──
  deps.bot.action(/^approve:(once|always|reject):(.+)$/, async (ctx) => {
    const match = ctx.match as RegExpMatchArray
    const response = match[1] as ApprovalResponse
    const permId = match[2]
    const p = deps.pendingApprovals.get(permId)

    if (!p) {
      await ctx.answerCbQuery('This request has already been handled.')
      return
    }

    try {
      await (deps.client as any).postSessionIdPermissionsPermissionId({
        path: { id: p.sessionId, permissionID: p.permissionId },
        body: { response },
      })
    } catch (err) {
      log.error(`failed to reply permission ${permId}`, err as Error)
      await ctx.answerCbQuery('Failed to reply. The request may have expired.')
      return
    }

    deps.pendingApprovals.delete(permId)

    const labels: Record<ApprovalResponse, string> = {
      once: 'Allowed (once)',
      always: 'Always Allowed',
      reject: 'Rejected',
    }
    const display = labels[response]
    await ctx.editMessageText(`${display}\n\n${p.title}`, { parse_mode: 'HTML' }).catch(() => {})
    await ctx.answerCbQuery(display)
  })
}

// ── Approval sub-module ──

export interface PendingApproval {
  sessionId: string
  permissionId: string
  messageId: number
  title: string
}

export type ApprovalResponse = 'once' | 'always' | 'reject'
