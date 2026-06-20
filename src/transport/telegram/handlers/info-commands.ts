import type { Telegraf, Context } from 'telegraf'
import type { AgentBackend } from '../../../core/agent/backend.js'
import type { SessionState } from '../../../core/state.js'
import { createLogger } from '../../../utils/logger.js'

const log = createLogger('info-commands')

interface InfoDeps {
  bot: Telegraf
  backend: AgentBackend
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
      const diffs = await deps.backend.getDiff(last)
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
        lines.push(`<code>+${add} -${del}</code>  ${esc(d.path)}`)
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
      const todos = (await deps.backend.getTodos(last)) as Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>
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
      const s = await deps.backend.getContext(last)
      const agents = await deps.backend.getAgents()
      const agentCfg = s.agent ? agents.find(a => a.name === s.agent) : undefined
      const model = agentCfg?.model
      const tokens = s.tokens as { input?: number; output?: number; cache?: number } | undefined
      const nextAgent = deps.state.getNextAgent()
      const nextModel = deps.state.getNextModel()
      const fmt = (n: number) => n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n)
      const row = (label: string, value: string) => `  <b>${label}</b>   ${value}`
      const lines = [
        `📊  <b>Context</b>  ·  <code>…${last.slice(-8)}</code>`,
        '',
        row('Agent',  s.agent ?? '—'),
        row('Model',  model ? `<code>${model}</code>` : '—'),
        row('Tokens', `↑${fmt(tokens?.input ?? 0)}  ↓${fmt(tokens?.output ?? 0)}  cached ${fmt(tokens?.cache ?? 0)}`),
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
