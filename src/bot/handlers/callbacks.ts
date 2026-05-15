import type { Telegraf } from 'telegraf'
import { Markup } from 'telegraf'
import { checkHealth } from '../../opencode/client.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('callbacks')

interface CallbacksDeps {
  bot: Telegraf
  baseUrl: string
  getLastSessionId: () => string | undefined
  setLastSessionId: (id: string | undefined) => void
  isGenerating: () => boolean
  abortGeneration: () => void
}

export function registerCallbacks(deps: CallbacksDeps): void {
  deps.bot.action(/^session:pin:(.+)$/, async (ctx) => {
    const id = ctx.match[1]
    deps.setLastSessionId(id)
    await ctx.answerCbQuery(`Pinned ${id.slice(-8)}`)
    await ctx.editMessageText(
      `<b>📌 Pinned</b>\n\n<code>${id}</code>`,
      { parse_mode: 'HTML' },
    )
  })

  deps.bot.action('session:unpin', async (ctx) => {
    deps.setLastSessionId(undefined)
    await ctx.answerCbQuery('Unpinned')
    await ctx.editMessageText(
      '<b>📌 Session unpinned</b>\n\nMessages will use the newest session.',
      { parse_mode: 'HTML' },
    )
  })

  deps.bot.action('status:refresh', async (ctx) => {
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
    if (deps.isGenerating()) {
      buttons.push(Markup.button.callback('🛑 Abort', 'status:abort'))
    }
    await ctx.editMessageText(lines.join('\n'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([buttons]),
    })
    await ctx.answerCbQuery('Refreshed')
  })

  deps.bot.action('status:abort', async (ctx) => {
    deps.abortGeneration()
    const last = deps.getLastSessionId()
    if (last) {
      try {
        await fetch(`${deps.baseUrl}/session/${last}/abort`, { method: 'POST' })
      } catch {}
    }
    await ctx.answerCbQuery('Aborting…')
    await ctx.editMessageText('🛑 Generation aborted.', { parse_mode: 'HTML' })
  })
}
