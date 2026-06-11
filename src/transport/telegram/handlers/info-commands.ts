import type { Telegraf, Context } from 'telegraf'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../../core/state.js'
import { createLogger } from '../../../utils/logger.js'

const log = createLogger('info-commands')

interface InfoDeps {
  bot: Telegraf
  // opencode API access via the in-process SDK client — opencode 1.17 runs
  // plugins in a worker thread where Bun's fetch can't reach ctx.serverUrl, so
  // raw fetch(baseUrl/...) is unusable.
  client: OpencodeClient
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
      const res = await deps.client.session.diff({ path: { id: last } })
      const diffs = (res.data ?? []) as Array<{ file: string; additions?: number; deletions?: number }>
      if (diffs.length === 0) {
        await ctx.reply(`<b>📝 Diff — …${last.slice(-8)}</b>\n\nNo diffs yet.`, { parse_mode: 'HTML' })
        return
      }
      const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
      const lines: string[] = [`<b>📝 Diff — …${last.slice(-8)}</b>`, '']
      let totalAdd = 0
      let totalDel = 0
      for (const d of diffs.slice(0, 40)) {
        const add = d.additions ?? 0
        const del = d.deletions ?? 0
        totalAdd += add
        totalDel += del
        lines.push(`<code>+${add} -${del}</code>  ${esc(d.file)}`)
      }
      if (diffs.length > 40) lines.push(`…and ${diffs.length - 40} more`)
      lines.push('', `<i>${diffs.length} file${diffs.length > 1 ? 's' : ''} · +${totalAdd} -${totalDel}</i>`)
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
    } catch (err) {
      log.error('diff failed', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('todo', async (ctx: Context) => {
    const last = deps.state.getLastSessionId()
    if (!last) { await ctx.reply('No session yet.', { parse_mode: 'HTML' }); return }
    try {
      const res = await deps.client.session.todo({ path: { id: last } })
      const todos = (res.data ?? []) as Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>
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
      log.error('todo failed', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })

  deps.bot.command('context', async (ctx: Context) => {
    const last = deps.state.getLastSessionId()
    if (!last) { await ctx.reply('No session yet.', { parse_mode: 'HTML' }); return }
    try {
      const sRes = await deps.client.session.get({ path: { id: last } })
      const s = (sRes.data ?? {}) as {
        agent?: string
        tokens?: { input?: number; output?: number; cache?: number }
        cost?: number
      }
      const cRes = await deps.client.config.get()
      const c = (cRes.data ?? {}) as { agent?: Record<string, { model?: string }> }
      const model = s.agent && c.agent?.[s.agent]?.model
      const nextAgent = deps.state.getNextAgent()
      const nextModel = deps.state.getNextModel()
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
      if (nextAgent || nextModel) {
        lines.push('', '  <b>Next override ›</b>')
        if (nextAgent) lines.push(`    Agent: <b>${nextAgent}</b>`)
        if (nextModel) lines.push(`    Model: <code>${nextModel.providerID}/${nextModel.modelID}</code>`)
      }
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
    } catch (err) {
      log.error('context failed', err as Error)
      await ctx.reply(`❌ ${(err as Error).message}`, { parse_mode: 'HTML' })
    }
  })
}
