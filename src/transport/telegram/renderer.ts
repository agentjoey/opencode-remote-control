import type { Telegram } from 'telegraf'
import type { StructuredCard, ToolCall, AssistantMeta, InfoSection, ContentBlock } from '../../core/structured-card.js'
import { markdownToTelegramHtml } from '../../utils/markdown.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('tg-renderer')

const RESERVE_META = 200
const RESERVE_ANSWER_FRAC = 0.7
const DEFAULT_CHUNK_SOFT_LIMIT = 3500

interface RendererOpts {
  chatId: string
  sessionId: string
  bot: Telegram
  chunkSoftLimit?: number
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Strip HTML tags and unescape entities — used for the plain-text send fallback. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
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

/** Hard-split a single line that is itself longer than perChunk. */
function hardWrap(line: string, perChunk: number): string[] {
  if (line.length <= perChunk) return [line]
  const parts: string[] = []
  for (let i = 0; i < line.length; i += perChunk) parts.push(line.slice(i, i + perChunk))
  return parts
}

/**
 * Split markdown into chunks under perChunk, breaking only at line boundaries.
 * Breaking at line boundaries (never mid-line) avoids splitting an inline bold
 * or code token across two messages, which renders as unbalanced HTML and trips
 * Telegram's "can't parse entities" 400. A fenced code block smaller than
 * perChunk stays intact; one larger than perChunk is broken (each chunk is
 * still valid HTML — markdownToTelegramHtml closes a dangling fence).
 */
export function splitMarkdown(md: string, perChunk: number): string[] {
  const out: string[] = []
  let cur: string[] = []
  let curLen = 0
  const flush = () => { if (cur.length) { out.push(cur.join('\n')); cur = []; curLen = 0 } }
  for (const rawLine of md.split('\n')) {
    for (const line of hardWrap(rawLine, perChunk)) {
      if (cur.length > 0 && curLen + line.length + 1 > perChunk) flush()
      cur.push(line)
      curLen += line.length + 1
    }
  }
  flush()
  return out.length ? out : ['']
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
  private chunkSoftLimit: number

  constructor(opts: RendererOpts) {
    this.chatId = opts.chatId
    this.sessionId = opts.sessionId
    this.bot = opts.bot
    this.chunkSoftLimit = opts.chunkSoftLimit ?? Number(process.env.TG_CHUNK_SOFT_LIMIT ?? DEFAULT_CHUNK_SOFT_LIMIT)
  }

  /**
   * sendMessage with a 10s timeout to prevent TCP hang. If Telegram rejects the
   * HTML (can't parse entities), retry once as plain text so the content is
   * still delivered rather than silently dropped.
   */
  private async sendTimed(text: string, extra?: Record<string, unknown>): Promise<{ message_id: number }> {
    try {
      return await withTimeout(this.bot.sendMessage(this.chatId, text, extra ?? {}), 'sendMessage')
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (extra && 'parse_mode' in extra && /parse entities|parse_mode|unsupported start tag|can't find end/i.test(msg)) {
        log.warn(`sendMessage HTML parse error, retrying as plain text: ${msg}`)
        const { parse_mode, ...rest } = extra
        return await withTimeout(this.bot.sendMessage(this.chatId, stripTags(text), rest), 'sendMessage(plain)')
      }
      throw err
    }
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
    try {
      const sent = await this.sendTimed('⏳  Working…', { parse_mode: 'HTML' })
      this.thinkingMessageId = String(sent.message_id)
    } catch (err) {
      log.warn('startThinking: initial message failed, continuing without placeholder', (err as Error).message)
    }
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

      const PER_CHUNK = Math.floor((this.chunkSoftLimit - RESERVE_META) * RESERVE_ANSWER_FRAC)
      const pieces = splitMarkdown(md, PER_CHUNK)
      log.debug(`finalize: md=${md.length} chars, ${pieces.length} piece(s)`)

      for (let i = 0; i < pieces.length; i++) {
        const isLast = i === pieces.length - 1
        const body = this.renderChunkBody(pieces[i], i === 0 ? tools : [], isLast ? { meta } : {})
        await this.sendTimed(body, { parse_mode: 'HTML' })
        log.debug(`finalize: piece ${i + 1}/${pieces.length} sent (len=${body.length})`)
      }
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
