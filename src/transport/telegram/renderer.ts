import type { Telegram } from 'telegraf'
import type { StructuredCard, ToolCall, AssistantMeta, InfoSection, ContentBlock } from '../../core/structured-card.js'
import { markdownToTelegramHtml } from '../../utils/markdown.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('tg-renderer')

const RESERVE_META = 200
const RESERVE_ANSWER_FRAC = 0.7
const CHUNK_SOFT_LIMIT = Number(process.env.TG_CHUNK_SOFT_LIMIT ?? 3500)

interface RendererOpts {
  chatId: string
  sessionId: string
  bot: Telegram
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Wrap a promise with a 10s timeout to prevent hanging on stuck TCP connections. */
async function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  const result = await Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), 10_000)),
  ])
  return result
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function metaFooter(meta: AssistantMeta): string {
  const parts: string[] = []
  if (typeof meta.cost === 'number') parts.push(`💰 $${meta.cost.toFixed(3)}`)
  if (meta.tokens) parts.push(`↑${fmtK(meta.tokens.input)} ↓${fmtK(meta.tokens.output)}`)
  if (meta.agent) parts.push(meta.agent)
  if (meta.model) parts.push(meta.model)
  return parts.join('  ·  ')
}

function findBoundary(md: string, near: number): number {
  const para = md.lastIndexOf('\n\n', near)
  if (para >= near - 500 && para > 0) return para + 2
  const line = md.lastIndexOf('\n', near)
  if (line >= near - 200 && line > 0) return line + 1
  return near
}

function splitMarkdown(md: string, perChunk: number): string[] {
  const out: string[] = []
  let pos = 0
  while (pos < md.length) {
    const remaining = md.slice(pos)
    if (remaining.length <= perChunk) { out.push(remaining); break }
    const cut = findBoundary(remaining, perChunk)
    out.push(remaining.slice(0, cut))
    pos += cut
  }
  return out
}

function collapseTools(tools: ToolCall[]): ToolCall[] {
  if (tools.length <= 7) return tools
  const running = tools.filter((t) => t.status === 'running')
  const done = tools.filter((t) => t.status !== 'running')
  const tailCount = tools.length <= 15 ? 5 : 4
  const firstCount = tools.length <= 15 ? 2 : 1
  const first = done.slice(0, firstCount)
  const tailDone = done.slice(firstCount).slice(-(tailCount - Math.min(running.length, tailCount)))
  const tail = [...tailDone, ...running].slice(-tailCount)
  const middleCount = tools.length - first.length - tail.length
  if (middleCount <= 0) return [...first, ...tail]
  return [...first, { tool: '__more__', args: `${middleCount} more tool calls`, status: 'done' as const }, ...tail]
}

/** Extract flat markdown string from blocks (concatenate all text blocks). */
function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
}

/** Extract ToolCall[] from blocks. */
function blocksToTools(blocks: ContentBlock[]): ToolCall[] {
  return blocks
    .filter((b): b is { type: 'tool'; tool: string; args: string; status: 'running' | 'done' | 'error' } => b.type === 'tool')
    .map(b => ({ tool: b.tool, args: b.args, status: b.status }))
}

export class TelegramSessionRenderer {
  private chatId: string
  private sessionId: string
  private bot: Telegram
  private thinkingMessageId?: string

  constructor(opts: RendererOpts) {
    this.chatId = opts.chatId
    this.sessionId = opts.sessionId
    this.bot = opts.bot
  }

  /** sendMessage with 10s timeout to prevent TCP hang. */
  private async sendTimed(text: string, extra?: Record<string, unknown>): Promise<{ message_id: number }> {
    const result: { message_id: number } = await withTimeout(
      this.bot.sendMessage(this.chatId, text, extra ?? {}),
      'sendMessage',
    )
    return result
  }

  async onCard(card: StructuredCard): Promise<void> {
    switch (card.kind) {
      case 'thinking':     return this.startThinking()
      case 'streaming':    return // no-op — Telegram only delivers final result
      case 'assistant':    return this.finalize(card.blocks, card.meta)
      case 'error':        return this.markError(card.message)
      case 'user':         {
        const userText = card.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        await this.sendTimed(`<i>${userText.slice(0, 200)}${userText.length > 200 ? '…' : ''}</i>`, { parse_mode: 'HTML' })
        return
      }
      case 'think-stream': return       // disabled
      case 'status':
      case 'approval':     return       // Handled by command handlers
      case 'info':         return this.sendInfo(card.title, card.sections)
    }
  }

  private async startThinking(): Promise<void> {
    const sent = await this.sendTimed('⏳  Working…', { parse_mode: 'HTML' })
    this.thinkingMessageId = String(sent.message_id)
  }

  private async finalize(blocks: ContentBlock[], meta: AssistantMeta): Promise<void> {
    try {
      // Delete thinking placeholder if present
      if (this.thinkingMessageId) {
        await this.bot.deleteMessage(this.chatId, Number(this.thinkingMessageId)).catch(() => {})
        this.thinkingMessageId = undefined
      }

      const md = blocksToText(blocks)
      const tools = blocksToTools(blocks)
      log.info(`finalize: md=${md.length} chars`)

      const PER_CHUNK = Math.floor((CHUNK_SOFT_LIMIT - RESERVE_META) * RESERVE_ANSWER_FRAC)
      const pieces = splitMarkdown(md, PER_CHUNK)
      log.info(`finalize: ${pieces.length} piece(s)`)

      for (let i = 0; i < pieces.length; i++) {
        const isLast = i === pieces.length - 1
        const body = this.renderChunkBody(pieces[i], i === 0 ? tools : [], isLast ? { meta } : {})
        log.info(`finalize: piece ${i}/${pieces.length} sending len=${body.length}`)
        const sent = await this.sendTimed(body, { parse_mode: 'HTML' })
        log.info(`finalize: piece ${i} sent ${sent.message_id}`)
      }
      log.info('finalize: all pieces done')
    } catch (err) {
      log.error('finalize: FATAL error, attempting last-resort send', (err as Error).message)
      try {
        const md = blocksToText(blocks)
        if (md) {
          await this.sendTimed(md.slice(0, 3800), { parse_mode: 'HTML' })
          log.info('finalize: last-resort send succeeded')
        }
      } catch (e2) {
        log.error('finalize: last-resort send also failed', (e2 as Error).message)
      }
    }
  }

  private async markError(message: string): Promise<void> {
    const text = `❌  <b>Error</b>\n\n<code>${escHtml(message)}</code>`
    await this.sendTimed(text, { parse_mode: 'HTML' })
  }

  private async sendInfo(title: string, sections: InfoSection[]): Promise<void> {
    const lines: string[] = []
    if (title) lines.push(`<b>${escHtml(title)}</b>`)
    for (const s of sections) {
      if (s.heading) lines.push(`<u>${escHtml(s.heading)}</u>`)
      lines.push(markdownToTelegramHtml(s.body))
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.sendTimed(lines.join('\n'), { parse_mode: 'HTML' })
        return
      } catch (err) {
        const msg = (err as Error).message
        if (attempt < 2 && /ECONNRESET|ETIMEDOUT|network/i.test(msg)) {
          log.warn(`sendInfo retry ${attempt + 1}/3: ${msg}`)
          await new Promise((r) => setTimeout(r, 2000))
        } else {
          log.warn('sendInfo failed', msg)
          return
        }
      }
    }
  }

  private renderChunkBody(md: string, tools: ToolCall[], opts: { streaming?: boolean; meta?: AssistantMeta }): string {
    const lines: string[] = []
    const collapsed = collapseTools(tools)
    if (collapsed.length > 0) {
      for (const t of collapsed) {
        if (t.tool === '__more__') {
          lines.push(`… ${t.args}`)
        } else {
          const mark = t.status === 'done' ? '✓' : t.status === 'error' ? '✗' : '…'
          lines.push(`▸ ${t.tool}${t.args ? ` · ${escHtml(t.args)}` : ''} ${mark}`)
        }
      }
      lines.push('')
    }
    if (md) lines.push(markdownToTelegramHtml(md))
    if (opts.meta) {
      const footer = metaFooter(opts.meta)
      if (footer) { lines.push(''); lines.push('──────────'); lines.push(`<i>${escHtml(footer)}</i>`) }
    }
    return lines.join('\n')
  }
}
