import type { Telegraf, Context } from 'telegraf'
import { Markup } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../core/state.js'
import type { EventStream } from '../../opencode/event-stream.js'
import { checkHealth } from '../../opencode/client.js'
import { createLogger } from '../../utils/logger.js'
import { registerInfoCommands } from './handlers/info-commands.js'

const log = createLogger('handlers')

export interface HandlersDeps {
  bot: Telegraf
  client: OpencodeClient
  baseUrl: string
  state: SessionState
  eventStream: EventStream
  chatId: number
  isGenerating: () => boolean
  abortGeneration: () => void
}

interface AgentConfig {
  name: string
  model: string
  description: string
}

async function fetchUserAgents(baseUrl: string): Promise<AgentConfig[]> {
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

function parseModel(modelStr: string): { providerID: string; modelID: string } {
  const slash = modelStr.indexOf('/')
  if (slash !== -1) {
    return { providerID: modelStr.slice(0, slash), modelID: modelStr.slice(slash + 1) }
  }
  return { providerID: 'opencode', modelID: modelStr }
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
  try {
    const res = await fetch(`${deps.baseUrl}/session/status`)
    const data = (await res.json()) as Record<string, { type: string }>
    totalSessions = Object.keys(data).length
    busyCount = Object.values(data).filter((s) => s.type === 'busy').length
  } catch {}
  const tuiSession = deps.state.getTuiSelectedSession()
  const currentAgent = deps.state.getCurrentAgent()
  const nextAgent = deps.state.getNextAgent()
  const nextModel = deps.state.getNextModel()
  const lines = [
    `<b>${healthy ? '🟢' : '🔴'} opencode ${healthy ? 'healthy' : 'unreachable'}</b>`,
    '',
    `📊 ${totalSessions} session${totalSessions !== 1 ? 's' : ''}  ·  ${busyCount} busy`,
    ...(tuiSession ? [`📌 <code>…${tuiSession.slice(-8)}</code>${currentAgent ? ` (${currentAgent})` : ''}`] : []),
    ...(nextAgent ? [`🤖 Next-agent override: <b>${nextAgent}</b>`] : []),
    ...(nextModel ? [`⚙️ Next-model override: <code>${nextModel.providerID}/${nextModel.modelID}</code>`] : []),
  ]
  const buttons: ReturnType<typeof Markup.button.callback>[] = [
    Markup.button.callback('🔄 Refresh', 'status:refresh'),
  ]
  if (deps.isGenerating()) {
    buttons.push(Markup.button.callback('🛑 Abort', 'status:abort'))
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
      `<b>👋 Hi ${username}!</b>`,
      '',
      `opencode ${healthy ? '🟢 ready' : '🔴 unreachable'}.`,
      'Send any text to relay to opencode.',
      '',
      '<b>Commands:</b>',
      '  /status   Server health + session',
      '  /sessions List all sessions',
      '  /session  Pin a session',
      '  /files    Files touched in last session',
      '  /agent    Set next agent',
      '  /model    Set next model',
      '  /current  Last session used',
      '  /abort    Stop generation',
      '  /help     This message',
    ]
    if (nextAgent) lines.push('', `<i>Next agent: ${nextAgent}</i>`)
    if (nextModel) lines.push(`<i>Next model: ${nextModel.providerID}/${nextModel.modelID}</i>`)
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Check status', 'status:refresh')],
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
      deps.state.setLastSessionId(args)
      // Also sync to TUI if possible
      try {
        await fetch(`${deps.baseUrl}/tui/select-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionID: args }),
          signal: AbortSignal.timeout(5000),
        })
      } catch {}
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
    const last = deps.state.getLastSessionId()
    if (!last) {
      await ctx.reply(
        'No session pinned. Send a message or use /sessions to choose one.',
        { parse_mode: 'HTML' },
      )
      return
    }
    await ctx.reply(
      `<b>📌 Pinned session</b>\n\n<code>${last}</code>`,
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
        await ctx.reply('<b>🤖 Agent</b>\n\nNo agents configured. Add them in <code>opencode.jsonc</code>.', { parse_mode: 'HTML' })
        return
      }
      const nextAgent = deps.state.getNextAgent()
      const lines = ['<b>🤖 Agent</b>', '']
      for (const a of agents) {
        const marker = a.name === nextAgent ? '●' : '○'
        const desc = a.description ? `  <i>${a.description}</i>` : ''
        lines.push(`${marker}  ${a.name}  <code>${a.model}</code>${desc}`)
      }
      lines.push('', '<i>Tap an agent to use it for the next message.</i>')
      const rows = agents.map(a => [
        Markup.button.callback(a.name, `agent:set:${a.name}`),
      ])
      rows.push([Markup.button.callback('✕ Clear', 'agent:clear')])
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
      const agents = await fetchUserAgents(deps.baseUrl)
      const nextModel = deps.state.getNextModel()
      const lines = ['<b>⚙️ Model</b>', '']
      if (agents.length === 0) {
        lines.push('<i>No agent-pinned models configured.</i>')
      } else {
        for (const a of agents) {
          const marker = nextModel && a.model === `${nextModel.providerID}/${nextModel.modelID}` ? '●' : '○'
          const slash = a.model.indexOf('/')
          const modelId = slash !== -1 ? a.model.slice(slash + 1) : a.model
          lines.push(`${marker}  ${modelId}  <i>via ${a.name}</i>`)
        }
      }
      lines.push('', '<i>Tap a model to use it (and its agent) for the next message.</i>')
      const rows = agents.map(a => {
        const slash = a.model.indexOf('/')
        const modelId = slash !== -1 ? a.model.slice(slash + 1) : a.model
        return [Markup.button.callback(`${modelId} (${a.name})`, `model:set:${a.name}:${a.model}`)]
      })
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
      const res = await fetch(`${deps.baseUrl}/session/${last}/abort`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await ctx.reply(`<b>🛑 Aborted</b>\n\n<code>…${last.slice(-8)}</code>`, { parse_mode: 'HTML' })
    } catch (err) {
      await ctx.reply(`❌ Abort failed: ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
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
        '  /agent   Set next agent',
        '  /model   Set next model',
        '  /current Last session used',
        '  /abort   Stop generation',
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
      { command: 'agent', description: 'Set next agent' },
      { command: 'model', description: 'Set next model' },
      { command: 'current', description: 'Last session used' },
      { command: 'abort', description: 'Stop the current generation' },
      { command: 'help', description: 'Show help' },
    ])
    .catch((err) => log.warn('setMyCommands failed', err))

  // ── Callbacks ──

  deps.bot.action(/^session:pin:(.+)$/, async (ctx) => {
    const id = ctx.match[1]
    deps.state.setLastSessionId(id)
    await ctx.answerCbQuery(`Pinned ${id.slice(-8)}`)
    await ctx.editMessageText(
      `<b>📌 Pinned</b>\n\n<code>${id}</code>`,
      { parse_mode: 'HTML' },
    )
  })

  deps.bot.action('session:unpin', async (ctx) => {
    deps.state.setLastSessionId(undefined)
    await ctx.answerCbQuery('Unpinned')
    await ctx.editMessageText(
      '<b>📌 Session unpinned</b>\n\nMessages will use the newest session.',
      { parse_mode: 'HTML' },
    )
  })

  deps.bot.action('status:refresh', async (ctx) => {
    const { lines, buttons } = await buildStatusCard(deps)
    await ctx.editMessageText(lines.join('\n'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([buttons]),
    })
    await ctx.answerCbQuery('Refreshed')
  })

  deps.bot.action('status:abort', async (ctx) => {
    deps.abortGeneration()
    const last = deps.state.getLastSessionId()
    if (last) {
      try {
        await fetch(`${deps.baseUrl}/session/${last}/abort`, { method: 'POST' })
      } catch {}
    }
    await ctx.answerCbQuery('Aborting…')
    await ctx.editMessageText('🛑 Generation aborted.', { parse_mode: 'HTML' })
  })

  deps.bot.action(/^agent:set:(.+)$/, async (ctx) => {
    const name = ctx.match[1]
    deps.state.setNextAgent(name)
    await ctx.answerCbQuery(`Agent → ${name}`)
    await ctx.editMessageText(
      `<b>🤖 Agent set</b>\n\nNext message will use <b>${name}</b>.`,
      { parse_mode: 'HTML' },
    )
  })

  deps.bot.action('agent:clear', async (ctx) => {
    deps.state.setNextAgent(undefined)
    await ctx.answerCbQuery('Agent cleared')
    await ctx.editMessageText(
      '<b>🤖 Agent cleared</b>\n\nNext message will use the default agent.',
      { parse_mode: 'HTML' },
    )
  })

  deps.bot.action(/^model:set:(.+):(.+)$/, async (ctx) => {
    const agentName = ctx.match[1]
    const modelStr = ctx.match[2]
    const parsed = parseModel(modelStr)
    deps.state.setNextAgent(agentName)
    deps.state.setNextModel(parsed)
    await ctx.answerCbQuery(`Model → ${parsed.modelID}`)
    await ctx.editMessageText(
      `<b>⚙️ Model set</b>\n\nNext message will use <code>${parsed.providerID}/${parsed.modelID}</code> via <b>${agentName}</b>.`,
      { parse_mode: 'HTML' },
    )
  })

  deps.bot.action('model:clear', async (ctx) => {
    deps.state.setNextAgent(undefined)
    deps.state.setNextModel(undefined)
    await ctx.answerCbQuery('Model cleared')
    await ctx.editMessageText(
      '<b>⚙️ Model cleared</b>\n\nNext message will use the default model.',
      { parse_mode: 'HTML' },
    )
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
  registerInfoCommands({ bot: deps.bot, baseUrl: deps.baseUrl, state: deps.state })

  // ── Approval handler ──
  setupApproval(deps)
}

// ── Approval sub-module ──

interface PendingApproval {
  sessionId: string
  permissionId: string
  messageId: number
  title: string
}

type ApprovalResponse = 'once' | 'always' | 'reject'

function setupApproval(deps: HandlersDeps): void {
  const pending = new Map<string, PendingApproval>()

  const offUpdated = deps.eventStream.onAny(async (rawEvent: unknown) => {
    const ev = rawEvent as { type: string; properties: any }
    if (ev.type !== 'permission.updated') return

    const permId = ev.properties?.id as string | undefined
    const title = (ev.properties?.title as string | undefined) ?? 'Unknown operation'
    const sessionId = ev.properties?.sessionID as string | undefined
    if (!permId || !sessionId) {
      log.warn('permission.updated missing id or sessionID', ev.properties)
      return
    }

    const text = `🔐 Approval Required\n\n${title}`
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Allow Once', `approve:once:${permId}`),
        Markup.button.callback('🔓 Always', `approve:always:${permId}`),
      ],
      [Markup.button.callback('❌ Reject', `approve:reject:${permId}`)],
    ])

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
  })

  deps.bot.action(/^approve:(once|always|reject):(.+)$/, async (ctx) => {
    const match = ctx.match as RegExpMatchArray
    const response = match[1] as ApprovalResponse
    const permId = match[2]
    const p = pending.get(permId)

    if (!p) {
      await ctx.answerCbQuery('This request has already been handled.')
      return
    }

    try {
      const res = await fetch(`${deps.baseUrl}/permission/${permId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      log.error(`failed to reply permission ${permId}`, err as Error)
      await ctx.answerCbQuery('Failed to reply. The request may have expired.')
      return
    }

    pending.delete(permId)

    const labels: Record<ApprovalResponse, string> = {
      once: '✅ Allowed (once)',
      always: '🔓 Always Allowed',
      reject: '❌ Rejected',
    }
    const display = labels[response]
    await ctx.editMessageText(`${display}\n\n${p.title}`).catch(() => {})
    await ctx.answerCbQuery(display)
  })

  const offReplied = deps.eventStream.onAny(async (rawEvent: unknown) => {
    const ev = rawEvent as { type: string; properties: any }
    if (ev.type !== 'permission.replied') return

    const permId = ev.properties?.permissionID as string | undefined
    const response = ev.properties?.response as string | undefined
    if (!permId) return

    const p = pending.get(permId)
    if (!p) return

    pending.delete(permId)
    try {
      await deps.bot.telegram.editMessageText(
        deps.chatId,
        p.messageId,
        undefined,
        `${labelFor(response)} (from TUI)\n\n${p.title}`,
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
