import type { Telegraf, Context } from 'telegraf'
import { Markup } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../core/state.js'
import type { EventStream } from '../../opencode/event-stream.js'
import type { CardBus } from '../../core/card-bus.js'
import { createLogger } from '../../utils/logger.js'
import { getVersionInfo } from '../../utils/version.js'
import { registerInfoCommands } from './handlers/info-commands.js'

const log = createLogger('handlers')

export interface HandlersDeps {
  bot: Telegraf
  client: OpencodeClient
  state: SessionState
  chatId: number
  isGenerating: () => boolean
  abortGeneration: () => void
  /** opencode server base URL — required for legacy mode, optional for Plugin mode. */
  baseUrl?: string
  /** EventStream — required for legacy mode, optional for Plugin mode. */
  eventStream?: EventStream
  /** Shared pending-approval map so both sidecar and plugin mode use the same store. */
  pendingApprovals: Map<string, PendingApproval>
  /** CardBus — optional, available after transport start. */
  cardBus?: CardBus
}

interface AgentConfig {
  name: string
  model: string
  description: string
}

/** Returns true if the opencode HTTP API is reachable (has a baseUrl set). */
function hasHttpApi(baseUrl?: string): baseUrl is string {
  return !!(baseUrl && baseUrl.startsWith('http'))
}

/** Check health — always OK in plugin mode (in-process), or fetch /health endpoint. */
async function checkHealth(baseUrl?: string): Promise<boolean> {
  if (!hasHttpApi(baseUrl)) return true
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

async function fetchUserAgents(baseUrl?: string): Promise<AgentConfig[]> {
  if (!hasHttpApi(baseUrl)) {
    log.debug('fetchUserAgents: no baseUrl, returning empty')
    return []
  }
  const res = await fetch(`${baseUrl}/config`, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`/config HTTP ${res.status}`)
  const data = (await res.json()) as {
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
  const healthy = await checkHealth(deps.baseUrl)
  let busyCount = 0
  let totalSessions = 0
  let totalCost = 0
  if (hasHttpApi(deps.baseUrl)) {
    try {
      const res = await fetch(`${deps.baseUrl}/session/status`)
      const data = (await res.json()) as Record<string, { type: string }>
      totalSessions = Object.keys(data).length
      busyCount = Object.values(data).filter((s) => s.type === 'busy').length
      for (const sid of Object.keys(data)) {
        const c = deps.state.getSessionCost(sid)
        if (c !== undefined) totalCost += c
      }
    } catch {}
  } else {
    try {
      const result = await deps.client.session.list()
      const sessions = (result.data ?? []) as Array<{ id: string }>
      totalSessions = sessions.length
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
    const healthy = await checkHealth(deps.baseUrl)
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
      const result = await deps.client.session.list()
      const sessions = (result.data ?? []) as Array<{ id: string; title?: string; time?: { created?: number } }>
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
      const agents = await fetchUserAgents(deps.baseUrl)
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
      if (!hasHttpApi(deps.baseUrl)) {
        await ctx.reply('Model listing requires opencode HTTP API. Use legacy sidecar mode for this command.', { parse_mode: 'HTML' })
        return
      }
      const res = await fetch(`${deps.baseUrl}/config/providers`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`/config/providers HTTP ${res.status}`)
      const data = (await res.json()) as {
        providers?: Array<{ id: string; name: string; models: Record<string, { name: string }> }>
      }

      const providers = data.providers ?? []
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
      if (hasHttpApi(deps.baseUrl)) {
        const res = await fetch(`${deps.baseUrl}/session/${last}/abort`, { method: 'POST' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
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
    if (last && hasHttpApi(deps.baseUrl)) {
      try {
        await fetch(`${deps.baseUrl}/session/${last}/abort`, { method: 'POST' })
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
      const agents = await fetchUserAgents(deps.baseUrl)
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
      if (!hasHttpApi(deps.baseUrl)) {
        await ctx.answerCbQuery('Not available in plugin mode')
        return
      }
      const res = await fetch(`${deps.baseUrl}/config/providers`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as {
        providers?: Array<{ id: string; name: string; models: Record<string, { name: string }> }>
      }
      const provider = data.providers?.find(p => p.id === providerID)
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
      if (!hasHttpApi(deps.baseUrl)) {
        await ctx.answerCbQuery('Not available in plugin mode')
        return
      }
      const res = await fetch(`${deps.baseUrl}/config/providers`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as {
        providers?: Array<{ id: string; name: string; models: Record<string, { name: string }> }>
      }

      const providers = data.providers ?? []
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
  registerInfoCommands({ bot: deps.bot, baseUrl: deps.baseUrl ?? '', state: deps.state })

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

export function setupApproval(
  deps: HandlersDeps,
  pending: Map<string, PendingApproval>,
): void {

  const offUpdated = deps.eventStream!.onAny(async (rawEvent: unknown) => {
    const ev = rawEvent as { type: string; properties: any }
    if (ev.type?.startsWith('permission.')) {
      log.info(`permission event: type=${ev.type} id=${ev.properties?.id} sessionID=${ev.properties?.sessionID}`)
    }
    // Support both v1 (permission.updated) and v2 (permission.asked) event types
    if (ev.type !== 'permission.updated' && ev.type !== 'permission.asked') return

    const permId = ev.properties?.id as string | undefined
    const title = (ev.properties?.title as string | undefined)
      ?? (ev.properties?.permission as string | undefined)
      ?? 'Unknown operation'
    const sessionId = ev.properties?.sessionID as string | undefined
    if (!permId || !sessionId) {
      log.warn(`${ev.type} missing id or sessionID`, ev.properties)
      return
    }

    const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const text = `⚠️  <b>Permission Required</b>\n\n<code>${escaped}</code>`
    const keyboard = {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Once', `approve:once:${permId}`),
          Markup.button.callback('🔓 Always', `approve:always:${permId}`),
          Markup.button.callback('❌ Reject', `approve:reject:${permId}`),
        ],
      ]),
      parse_mode: 'HTML' as const,
    }

    try {
      const msg = await deps.bot.telegram.sendMessage(deps.chatId, text, keyboard)
      pending.set(permId, {
        sessionId,
        permissionId: permId,
        messageId: msg.message_id,
        title,
      })
      log.info(`approval card sent permId=${permId}`)
    } catch (err) {
      log.error('failed to send approval card', err as Error)
    }

    // Publish to CardBus so Web UI can also show the approval modal
    try {
      deps.cardBus?.publish({
        kind: 'approval',
        sessionId,
        title,
        args: ev.properties?.args ?? ev.properties?.permission ?? {},
        requestId: permId,
      })
    } catch (err) {
      log.warn('failed to publish approval card', err as Error)
    }
  })

  const offReplied = deps.eventStream!.onAny(async (rawEvent: unknown) => {
    const ev = rawEvent as { type: string; properties: any }
    if (ev.type !== 'permission.replied') return

    // v1 uses permissionID, v2 uses requestID
    const permId = (ev.properties?.permissionID as string | undefined)
      ?? (ev.properties?.requestID as string | undefined)
    const response = ev.properties?.response as string | undefined
      ?? ev.properties?.reply as string | undefined
    if (!permId) return

    const p = pending.get(permId)
    if (!p) return

    pending.delete(permId)
    try {
        const display = labelFor(response)
        await deps.bot.telegram.editMessageText(
          deps.chatId,
          p.messageId,
          undefined,
          `${display} (from TUI)\n\n${p.title}`,
          { parse_mode: 'HTML' },
        )
    } catch (err) {
      log.warn(`couldn't update card after TUI reply: ${(err as Error).message}`)
    }
  })

  // Store cleanup on bot stop (best effort)
  ;(deps.bot as any)._approvalCleanup = () => {
    offUpdated()
    offReplied()
  }
}

function labelFor(response?: string): string {
  switch (response) {
    case 'once':   return '✅ Allowed (once)'
    case 'always': return '🔓 Always Allowed'
    case 'reject': return '❌ Rejected'
    default:       return response ?? 'Handled'
  }
}
