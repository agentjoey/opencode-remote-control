import type { Telegraf, Context } from 'telegraf'
import type { SessionState } from '../../../core/state.js'
import { createLogger } from '../../../utils/logger.js'

const log = createLogger('info-commands')

interface InfoDeps {
  bot: Telegraf
  baseUrl: string
  state: SessionState
}

export function registerInfoCommands(deps: InfoDeps): void {
  deps.bot.command('diff', async (ctx: Context) => {
    const last = deps.state.getLastSessionId()
    if (!last) {
      await ctx.reply('<b>📝 Diff</b>\n\nNo session yet.', { parse_mode: 'HTML' })
      return
    }
    try {
      const res = await fetch(`${deps.baseUrl}/session/${last}/diff`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const diffs = (await res.json()) as Array<{ path: string; patch?: string }>
      if (diffs.length === 0) {
        await ctx.reply(`<b>📝 Diff — …${last.slice(-8)}</b>\n\nNo diffs yet.`, { parse_mode: 'HTML' })
        return
      }
      const PER_FILE_MAX = 10
      const MAX_CHARS = 4000
      const lines: string[] = [`<b>📝 Diff — …${last.slice(-8)}</b>`, '']
      let total = 0
      for (const d of diffs) {
        lines.push(`<b>${d.path}</b>`)
        const patch = (d.patch ?? '').split('\n').slice(0, PER_FILE_MAX)
        const block = '<pre>' + patch.join('\n').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!)) + '</pre>'
        total += block.length
        if (total > MAX_CHARS) { lines.push('…(truncated)'); break }
        lines.push(block)
        lines.push('')
      }
      lines.push(`<i>${diffs.length} file${diffs.length > 1 ? 's' : ''}</i>`)
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('todo', async (ctx: Context) => {
    const last = deps.state.getLastSessionId()
    if (!last) { await ctx.reply('No session yet.', { parse_mode: 'HTML' }); return }
    try {
      const res = await fetch(`${deps.baseUrl}/session/${last}/todo`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const todos = (await res.json()) as Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>
      if (todos.length === 0) {
        await ctx.reply(`<b>✅ Todos — …${last.slice(-8)}</b>\n\nNo todos.`, { parse_mode: 'HTML' })
        return
      }
      const mark = (s: string) => s === 'completed' ? '✓' : s === 'in_progress' ? '▶' : '○'
      const lines = [`✅  <b>Todos</b>  ·  <code>…${last.slice(-8)}</code>`, '']
      for (const t of todos) {
        const label = t.status === 'completed' ? `<s>${t.content}</s>` : t.content
        lines.push(`${mark(t.status)}  ${label}`)
      }
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('context', async (ctx: Context) => {
    const last = deps.state.getLastSessionId()
    if (!last) { await ctx.reply('No session yet.', { parse_mode: 'HTML' }); return }
    try {
      const sRes = await fetch(`${deps.baseUrl}/session/${last}`, { signal: AbortSignal.timeout(5000) })
      const s = (await sRes.json()) as {
        agent?: string
        tokens?: { input?: number; output?: number; cache?: number }
        cost?: number
      }
      const cRes = await fetch(`${deps.baseUrl}/config`, { signal: AbortSignal.timeout(5000) })
      const c = (await cRes.json()) as { agent?: Record<string, { model?: string }> }
      const model = s.agent && c.agent?.[s.agent]?.model
      const fmt = (n: number) => n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n)
      const row = (label: string, value: string) => `  <b>${label}</b>   ${value}`
      const lines = [
        `📊  <b>Context</b>  ·  <code>…${last.slice(-8)}</code>`,
        '',
        row('Agent',  s.agent ?? '—'),
        row('Model',  model ? `<code>${model}</code>` : '—'),
        row('Tokens', `↑${fmt(s.tokens?.input ?? 0)}  ↓${fmt(s.tokens?.output ?? 0)}  cached ${fmt(s.tokens?.cache ?? 0)}`),
        row('Cost',   `$${(s.cost ?? 0).toFixed(3)}`),
      ]
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })
}
