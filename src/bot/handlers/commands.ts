import type { Telegraf, Context } from 'telegraf'
import { Markup } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { checkHealth } from '../../opencode/client.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('commands')

/** Shorten a full file path to a project-relative or short form. */
function shortPath(p: string): string {
  // Try to extract project-relative path
  const idx = p.indexOf('/opencode-remote-control/')
  if (idx !== -1) return p.slice(idx + '/opencode-remote-control/'.length)
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

export function registerCommands(deps: CommandsDeps): void {
  deps.bot.command('start', async (ctx: Context) => {
    const healthy = await checkHealth(deps.baseUrl)
    const username = ctx.from?.first_name ?? 'there'
    const lines = [
      `<b>👋 Hi ${username}!</b>`,
      '',
      'opencode remote control ready.',
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
      const agentsRes = await fetch(`${deps.baseUrl}/agent`, { signal: AbortSignal.timeout(5000) })
      if (!agentsRes.ok) throw new Error(`HTTP ${agentsRes.status}`)
      const agents = (await agentsRes.json()) as Array<{
        name: string; description?: string; mode?: string; hidden?: boolean
      }>

      const visible = agents.filter((a) => !a.hidden)
      if (visible.length === 0) {
        await ctx.reply('<b>🤖 Agents</b>\n\nNo agents found.', { parse_mode: 'HTML' })
        return
      }

      const lines = ['<b>🤖 Agents</b>', '']
      for (const a of visible) {
        lines.push(`• <b>${a.name}</b>  <i>${a.description ?? ''}</i>`)
      }
      lines.push('', 'Tap a button to create a new session with that agent.')
      const rows = visible.map((a) => [
        Markup.button.callback(a.name, `agent:switch:${a.name}`),
      ])
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
      const providersRes = await fetch(`${deps.baseUrl}/config/providers`, { signal: AbortSignal.timeout(5000) })
      if (!providersRes.ok) throw new Error(`HTTP ${providersRes.status}`)
      const data = (await providersRes.json()) as {
        providers?: Array<{ id: string; name?: string; models?: Record<string, { id: string }> }>
        default?: Record<string, string>
      }

      const providers = data.providers ?? []
      const defaults = data.default ?? {}
      if (providers.length === 0) {
        await ctx.reply('<b>⚙️ Model</b>\n\nNo providers found.', { parse_mode: 'HTML' })
        return
      }

      const MAX_PROVIDERS = 4
      const MAX_MODELS_PER = 4
      const lines = ['<b>⚙️ Model</b>', '']
      const buttons: ReturnType<typeof Markup.button.callback>[] = []

      let providerCount = 0
      for (const p of providers) {
        if (providerCount >= MAX_PROVIDERS) break
        const models = p.models ?? {}
        const modelIds = Object.keys(models)
        if (modelIds.length === 0) continue

        lines.push(`<b>${p.name ?? p.id}</b>`)
        let modelCount = 0
        for (const mid of modelIds) {
          if (modelCount >= MAX_MODELS_PER) break
          const isCurrent = defaults[p.id] === mid
          const marker = isCurrent ? '●' : '○'
          const suffix = isCurrent ? '  (current)' : ''
          lines.push(`  ${marker} ${mid}${suffix}`)
          buttons.push(Markup.button.callback(
            `${isCurrent ? '✓' : ''}${mid.slice(0, 20)}`,
            `model:switch:${p.id}:${mid}`,
          ))
          modelCount++
        }
        if (modelIds.length > MAX_MODELS_PER) {
          lines.push(`  … and ${modelIds.length - MAX_MODELS_PER} more`)
        }
        lines.push('')
        providerCount++
      }
      if (providers.length > MAX_PROVIDERS) {
        lines.push(`<i>… and ${providers.length - MAX_PROVIDERS} more providers</i>`)
      }

      if (buttons.length > 12) buttons.length = 12
      const rows: Array<ReturnType<typeof Markup.button.callback>[]> = []
      for (let i = 0; i < buttons.length; i += 3) {
        rows.push(buttons.slice(i, i + 3))
      }
      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        ...(rows.length > 0 ? Markup.inlineKeyboard(rows) : undefined),
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
