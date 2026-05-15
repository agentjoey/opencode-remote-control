import type { Telegraf } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import { checkHealth } from '../../opencode/client.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('commands')

interface CommandsDeps {
  bot: Telegraf
  client: OpencodeClient
  baseUrl: string
  getLastSessionId: () => string | undefined
}

export function registerCommands(deps: CommandsDeps): void {
  deps.bot.command('start', async (ctx) => {
    const healthy = await checkHealth(deps.baseUrl)
    const username = ctx.from?.first_name ?? 'there'
    const lines = [
      `👋 Hi ${username}!`,
      '',
      'I relay your messages to your local opencode TUI session.',
      '',
      `opencode server: ${healthy ? '✅ healthy' : '❌ unreachable'}`,
      '',
      'Send any text to chat. Commands:',
      '/status — server + last session',
      '/sessions — list all sessions',
      '/current — last session this bot used',
      '/abort — stop the current generation',
      '/help — this message',
    ]
    await ctx.reply(lines.join('\n'))
  })

  deps.bot.command('status', async (ctx) => {
    const healthy = await checkHealth(deps.baseUrl)
    let busyCount = 0
    try {
      const res = await fetch(`${deps.baseUrl}/session/status`)
      const data = (await res.json()) as Record<string, { type: string }>
      busyCount = Object.values(data).filter((s) => s.type === 'busy').length
    } catch {
      // ignore
    }
    const last = deps.getLastSessionId()
    await ctx.reply(
      [
        `opencode: ${healthy ? '✅ healthy' : '❌ unreachable'}`,
        `busy sessions: ${busyCount}`,
        `last bot session: ${last ?? '(none yet)'}`,
      ].join('\n'),
    )
  })

  deps.bot.command('sessions', async (ctx) => {
    try {
      const result = await deps.client.session.list()
      const sessions = (result.data ?? []) as Array<{ id: string; title?: string; time?: { created?: number } }>
      if (sessions.length === 0) {
        await ctx.reply('No sessions.')
        return
      }
      const lines: string[] = ['📋 Sessions:', '']
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i]
        const when = s.time?.created
          ? new Date(s.time.created).toLocaleString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })
          : 'unknown'
        lines.push(`${i + 1}. ${s.id}`)
        lines.push(`   ${s.title ?? 'Untitled'} · ${when}`)
        lines.push('')
      }
      await ctx.reply(lines.join('\n'))
    } catch (err) {
      log.error('failed to list sessions', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`)
    }
  })

  deps.bot.command('current', async (ctx) => {
    const last = deps.getLastSessionId()
    if (!last) {
      await ctx.reply('No session used yet. Send a message to start one via the TUI.')
      return
    }
    await ctx.reply(`Last bot session: ${last}`)
  })

  deps.bot.command('abort', async (ctx) => {
    const last = deps.getLastSessionId()
    if (!last) {
      await ctx.reply('No session to abort.')
      return
    }
    try {
      const res = await fetch(`${deps.baseUrl}/session/${last}/abort`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await ctx.reply(`🛑 Aborted ${last}`)
    } catch (err) {
      await ctx.reply(`❌ Abort failed: ${(err as Error).message}`)
    }
  })

  deps.bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        'Commands:',
        '/start — handshake + health',
        '/status — server status + last session',
        '/sessions — list all opencode sessions',
        '/current — last session this bot used',
        '/abort — stop the current generation',
        '/help — this message',
        '',
        'Send any text to relay it into the TUI prompt.',
      ].join('\n'),
    )
  })

  deps.bot.telegram
    .setMyCommands([
      { command: 'start', description: 'Handshake and health' },
      { command: 'status', description: 'Server + last session' },
      { command: 'sessions', description: 'List all sessions' },
      { command: 'current', description: 'Last session used' },
      { command: 'abort', description: 'Stop the current generation' },
      { command: 'help', description: 'Show help' },
    ])
    .catch((err) => log.warn('setMyCommands failed', err))
}
