import type { Telegram } from 'telegraf'
import type { StructuredCard, ToolCall, AssistantMeta, InfoSection, ContentBlock } from '../../core/structured-card.js'
import { markdownToTelegramHtml } from '../../utils/markdown.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('tg-renderer')

const TG_MAX = 4000
const RESERVE_META = 200
const RESERVE_ANSWER_FRAC = 0.7
const CHUNK_SOFT_LIMIT = Number(process.env.TG_CHUNK_SOFT_LIMIT ?? 3500)
const CHUNK_HARD_LIMIT = Number(process.env.TG_CHUNK_HARD_LIMIT ?? 3900)

interface RendererOpts {
  chatId: string
  sessionId: string
  bot: Telegram
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Retry on Telegram 429 rate limit, up to 3 attempts with backoff.
 *  Each attempt has a 10s timeout to prevent hanging on stuck TCP connections. */
async function retryEdit(
  bot: Telegram,
  chatId: string,
  messageId: number,
  text: string,
  extra: Record<string, unknown>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await Promise.race([
        bot.editMessageText(chatId, messageId, undefined, text, extra as any),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('editMessageText timeout')), 10_000)),
      ])
      return true
    } catch (err) {
      const m = (err as any)?.response?.description ?? (err as Error).message
      const retryAfter = (err as any)?.response?.parameters?.retry_after as number | undefined
      if (typeof retryAfter === 'number' && attempt < 2) {
        const delay = (retryAfter + 1) * 1000
        log.warn(`edit 429 retry ${attempt + 1}/3 in ${delay}ms`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      if (m.includes('message is not modified')) {
        return true
      }
      log.warn('edit failed', m)
      return false
    }
  }
  return false
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
  private activeMessageId?: string
  private thinkingMessageId?: string
  private lastEditAt = 0
  private editsInBurst = 0
  private chunkIndex = 0
  private streamingChunkBuffer = ''
  private chunkStartOffset = 0

  constructor(opts: RendererOpts) {
    this.chatId = opts.chatId
    this.sessionId = opts.sessionId
    this.bot = opts.bot
  }

  private currentThrottleMs(): number {
    if (this.editsInBurst === 0) return 0
    if (this.editsInBurst < 3) return 250
    return 1500
  }

  async onCard(card: StructuredCard): Promise<void> {
    switch (card.kind) {
      case 'thinking':     return this.startThinking()
      case 'think-stream': return this.renderThinking(card.thinkingText)
      case 'streaming':    return this.renderStreaming(card.blocks)
      case 'assistant':    return this.finalize(card.blocks, card.meta)
      case 'error':        return this.markError(card.message)
      case 'user':         return       // Telegram already shows user's own message
      case 'status':
      case 'approval':     return       // Handled by command handlers, not via renderer in v0.5.0
      case 'info':         return this.sendInfo(card.title, card.sections)
    }
  }

  private async startThinking(): Promise<void> {
    const sent = await this.bot.sendMessage(this.chatId, '⏳  Working…', { parse_mode: 'HTML' })
    this.activeMessageId = String(sent.message_id)
  }

  private async renderThinking(text: string): Promise<void> {
    // Share throttle with renderStreaming
    const now = Date.now()
    if (now - this.lastEditAt < this.currentThrottleMs() && this.editsInBurst >= 3) return
    this.lastEditAt = now
    this.editsInBurst += 1

    const maxLen = 350
    const display = text.length > maxLen ? text.slice(0, maxLen) + '…' : text
    const body = `<i>💭 ${escHtml(display)}</i>`
    if (this.thinkingMessageId) {
      await retryEdit(this.bot, this.chatId, Number(this.thinkingMessageId), body, { parse_mode: 'HTML' as const })
    } else {
      const sent = await this.bot.sendMessage(this.chatId, body, { parse_mode: 'HTML' })
      this.thinkingMessageId = String(sent.message_id)
    }
  }

  private async renderStreaming(blocks: ContentBlock[]): Promise<void> {
    if (!this.activeMessageId) return
    const md = blocksToText(blocks)
    const tools = blocksToTools(blocks)
    const chunkMd = md.slice(this.chunkStartOffset)
    this.streamingChunkBuffer = md
    const renderedLen = this.renderChunkBody(chunkMd, tools, { streaming: true }).length
    const naturalBoundary = chunkMd.endsWith('\n\n') || tools.some((t) => t.status === 'done')

    if (renderedLen >= CHUNK_HARD_LIMIT || (renderedLen >= CHUNK_SOFT_LIMIT && naturalBoundary)) {
      try {
        await this.bot.editMessageText(this.chatId, Number(this.activeMessageId), undefined,
          this.renderChunkBody(chunkMd, tools, {}), { parse_mode: 'HTML' })
      } catch {}
      this.chunkIndex += 1
      this.chunkStartOffset = md.length
      const sent = await this.bot.sendMessage(this.chatId, '⏳', {
        parse_mode: 'HTML',
      })
      this.activeMessageId = String(sent.message_id)
      this.lastEditAt = 0
      this.editsInBurst = 0
      return
    }

    const now = Date.now()
    const since = now - this.lastEditAt
    const toolStatusChange = tools.some((t) => t.status === 'done' || t.status === 'error')
    if (!toolStatusChange && since < this.currentThrottleMs()) return

    this.lastEditAt = now
    this.editsInBurst += 1
    const text = this.renderChunkBody(chunkMd, tools, { streaming: true })
    await retryEdit(this.bot, this.chatId, Number(this.activeMessageId), text, {
      parse_mode: 'HTML' as const,
    })
  }

  private async finalize(blocks: ContentBlock[], meta: AssistantMeta): Promise<void> {
    try {
      if (this.thinkingMessageId) {
        await this.bot.deleteMessage(this.chatId, Number(this.thinkingMessageId)).catch(() => {})
        this.thinkingMessageId = undefined
      }

      const md = blocksToText(blocks)
      const tools = blocksToTools(blocks)

      log.info(`finalize: md=${md.length} chars, chunkOffset=${this.chunkStartOffset}, activeMessageId=${this.activeMessageId ?? 'none'}`)
      const remainMd = this.chunkStartOffset > md.length ? md : md.slice(this.chunkStartOffset)
      const PER_CHUNK = Math.floor((CHUNK_SOFT_LIMIT - RESERVE_META) * RESERVE_ANSWER_FRAC)
      const pieces = splitMarkdown(remainMd, PER_CHUNK)
      log.info(`finalize: ${pieces.length} piece(s), remainMd=${remainMd.length} chars`)
      if (pieces.length === 1) {
        const text = this.renderChunkBody(pieces[0], tools, { meta })
        if (this.activeMessageId) {
          log.info(`finalize: editing message ${this.activeMessageId}`)
          const ok = await retryEdit(this.bot, this.chatId, Number(this.activeMessageId), text, { parse_mode: 'HTML' as const })
          if (!ok) {
            log.info(`finalize: edit failed, sending new message`)
            const sent = await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' })
            this.activeMessageId = String(sent.message_id)
            log.info(`finalize: sent fallback message ${sent.message_id}`)
          } else {
            log.info('finalize: edit success')
          }
        } else {
          log.info('finalize: sending new message (no activeMessageId)')
          const sent = await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' })
          this.activeMessageId = String(sent.message_id)
          log.info(`finalize: sent new message ${sent.message_id}`)
        }
        return
      }
      for (let i = 0; i < pieces.length; i++) {
        const isLast = i === pieces.length - 1
        const body = this.renderChunkBody(pieces[i], i === 0 ? tools : [], isLast ? { meta } : {})
        log.info(`finalize: piece ${i}/${pieces.length} len=${body.length}`)
        if (i === 0 && this.activeMessageId) {
          const ok = await retryEdit(this.bot, this.chatId, Number(this.activeMessageId), body, { parse_mode: 'HTML' as const })
          if (ok) {
            log.info(`finalize: piece 0 edited message ${this.activeMessageId}`)
          } else {
            log.info(`finalize: piece 0 edit failed, sending new`)
            const sent = await this.bot.sendMessage(this.chatId, body, { parse_mode: 'HTML' })
            this.activeMessageId = String(sent.message_id)
            log.info(`finalize: piece 0 sent fallback ${sent.message_id}`)
          }
        } else {
          log.info(`finalize: piece ${i} sending new message`)
          const sent = await this.bot.sendMessage(this.chatId, body, { parse_mode: 'HTML' })
          this.activeMessageId = String(sent.message_id)
          log.info(`finalize: piece ${i} sent ${sent.message_id}`)
        }
      }
      log.info('finalize: all pieces done')
    } catch (err) {
      log.error('finalize: FATAL error, attempting last-resort send', (err as Error).message)
      // Last-resort: try to send the raw text without formatting
      try {
        const md = blocksToText(blocks)
        if (md) {
          await this.bot.sendMessage(this.chatId, md.slice(0, 3800), { parse_mode: 'HTML' })
          log.info('finalize: last-resort send succeeded')
        }
      } catch (e2) {
        log.error('finalize: last-resort send also failed', (e2 as Error).message)
      }
    }
  }

  private async markError(message: string): Promise<void> {
    const text = `❌  <b>Error</b>\n\n<code>${escHtml(message)}</code>`
    if (this.activeMessageId) {
      try { await this.bot.editMessageText(this.chatId, Number(this.activeMessageId), undefined, text, { parse_mode: 'HTML' }) }
      catch {}
    } else {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' })
    }
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
        await this.bot.sendMessage(this.chatId, lines.join('\n'), { parse_mode: 'HTML' })
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
