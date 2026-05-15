import type { Telegraf, Context } from 'telegraf'
import { Markup } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { checkHealth } from '../../opencode/client.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('commands')

/** Shorten a full file path to a project-relative or short form. */
function shortPath(p: string): string {
  const cwd = process.cwd()
  if (p.startsWith(cwd + '/')) return p.slice(cwd.length + 1)
  if (p.startsWith('/')) {
    const parts = p.split('/')
    if (parts.length > 3) return '…/' + parts.slice(-3).join('/')
  }
  return p
}

interface CommandsDeps {
  bot: Telegraf
  client: OpencodeClient
  baseUrl: string
  getLastSessionId: () => string | undefined
  setLastSessionId: (id: string | undefined) => void
  abortGeneration?: () => void
  isGenerating?: () => boolean
}

interface AgentConfig {
  name: string
  model: string
  description: string
}

/** Read the user-defined agents from /config.agent (plan/build/chat/audit etc). */
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

export function registerCommands(deps: CommandsDeps): void {
  deps.bot.command('start', async (ctx: Context) => {
    const healthy = await checkHealth(deps.baseUrl)
    const username = ctx.from?.first_name ?? 'there'
    const lines = [
      `<b>👋 Hi ${username}!</b>`,
      '',
      `opencode ${healthy ? '🟢 ready' : '🔴 unreachable'}.`,
      'Send any text to relay to the TUI.',
      '',
      '<b>Commands:</b>',
      '  /status   Server health + session',
      '  /sessions List all sessions',
      '  /session  Pin a session',
      '  /files    Files touched in last session',
      '  /agent    Switch agent',
      '  /model    Switch model',
      '  /current  Last session used',
      '  /abort    Stop generation',
      '  /help     This message',
    ]
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Check status', 'status:refresh')],
      ]),
    })
  })

  deps.bot.command('status', async (ctx: Context) => {
    const healthy = await checkHealth(deps.baseUrl)
    let busyCount = 0
    let totalSessions = 0
    try {
      const res = await fetch(`${deps.baseUrl}/session/status`)
      const data = (await res.json()) as Record<string, { type: string }>
      totalSessions = Object.keys(data).length
      busyCount = Object.values(data).filter((s) => s.type === 'busy').length
    } catch {}
    const last = deps.getLastSessionId()
    const lines = [
      `<b>${healthy ? '🟢' : '🔴'} opencode ${healthy ? 'healthy' : 'unreachable'}</b>`,
      '',
      `📊 ${totalSessions} session${totalSessions !== 1 ? 's' : ''}  ·  ${busyCount} busy`,
      ...(last ? [`📌 <code>…${last.slice(-8)}</code>`] : []),
    ]
    const buttons: ReturnType<typeof Markup.button.callback>[] = [
      Markup.button.callback('🔄 Refresh', 'status:refresh'),
    ]
    if (deps.isGenerating?.()) {
      buttons.push(Markup.button.callback('🛑 Abort', 'status:abort'))
    }
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
      const pinned = deps.getLastSessionId()
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
      deps.setLastSessionId(args)
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
    const last = deps.getLastSessionId()
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
    const last = deps.getLastSessionId()
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
              // patch always means edit
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
      // Read current session to highlight its agent
      let currentAgent: string | undefined
      const sid = deps.getLastSessionId()
      if (sid) {
        try {
          const sRes = await fetch(`${deps.baseUrl}/session/${sid}`, { signal: AbortSignal.timeout(5000) })
          if (sRes.ok) {
            const s = (await sRes.json()) as { agent?: string }
            currentAgent = s.agent
          }
        } catch {}
      }
      const lines = ['<b>🤖 Agent</b>', '']
      for (const a of agents) {
        const marker = a.name === currentAgent ? '●' : '○'
        const desc = a.description ? `  <i>${a.description}</i>` : ''
        lines.push(`${marker}  ${a.name}  <code>${a.model}</code>${desc}`)
      }
      lines.push('', '<i>Opencode TUI only supports cycling — tap to advance.</i>')
      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('→ Next agent', 'agent:cycle')],
          [Markup.button.callback('✕ Cancel', 'card:dismiss')],
        ]),
      })
    } catch (err) {
      log.error('failed to list agents', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('model', async (ctx: Context) => {
    try {
      const agents = await fetchUserAgents(deps.baseUrl)
      const lines = ['<b>⚙️ Model</b>', '']
      if (agents.length === 0) {
        lines.push('<i>No agent-pinned models configured.</i>')
      } else {
        for (const a of agents) {
          const slash = a.model.indexOf('/')
          const modelId = slash !== -1 ? a.model.slice(slash + 1) : a.model
          lines.push(`${modelId}  <i>via ${a.name}</i>`)
        }
      }
      lines.push('', '<i>Opencode TUI has no scripted model switch — tap to open the picker on your Mac.</i>')
      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🖥 Open model picker in TUI', 'model:picker')],
          [Markup.button.callback('✕ Cancel', 'card:dismiss')],
        ]),
      })
    } catch (err) {
      log.error('failed to list models', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('current', async (ctx: Context) => {
    const last = deps.getLastSessionId()
    if (!last) {
      await ctx.reply(
        '<b>📍 No session</b>\n\nSend a message to start one via the TUI.',
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
    const last = deps.getLastSessionId()
    if (!last) {
      await ctx.reply('No session to abort.', { parse_mode: 'HTML' })
      return
    }
    deps.abortGeneration?.()
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
        '  /agent   Switch agent',
        '  /model   Switch model',
        '  /current Last session used',
        '  /abort   Stop generation',
        '  /help    This message',
        '',
        'Send any text to relay it into the TUI prompt.',
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
      { command: 'agent', description: 'Switch agent' },
      { command: 'model', description: 'Switch model' },
      { command: 'current', description: 'Last session used' },
      { command: 'abort', description: 'Stop the current generation' },
      { command: 'help', description: 'Show help' },
    ])
    .catch((err) => log.warn('setMyCommands failed', err))
}
