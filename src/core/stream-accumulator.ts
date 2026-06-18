import type { ContentBlock } from './structured-card.js'

/**
 * StreamAccumulator — collects streaming part updates and produces an ordered,
 * deduplicated block list suitable for final rendering.
 *
 * Mirrors the SDK's `EventMessagePartUpdated` model:
 * - Each Part has a unique `id` string.
 * - Part.text is the FULL content of that part (not a delta).
 * - Block order is determined by first-seen insertion time.
 * - Re-deliveries of the same part.id replace the previous state.
 */

interface InternalBlock {
  type: 'text' | 'tool' | 'reasoning'
  partId: string
  text: string
  tool?: string
  args: string
  status: 'running' | 'done' | 'error'
}

export interface StreamAccumulator {
  update(parts: PartInput[]): ContentBlock[]
  finalize(): ContentBlock[]
  getText(): string
  getTools(): ContentBlock[]
  reset(): void
}

/**
 * Normalized part fields (backend-agnostic). `args`/`status` are already
 * summarized/mapped by the per-backend normalizer — the accumulator no longer
 * reaches into an opencode-shaped `state` object.
 */
export interface PartInput {
  id: string
  type: 'text' | 'tool' | 'reasoning' | string
  text?: string
  tool?: string
  args?: string
  status?: 'running' | 'done' | 'error'
}

export function createStreamAccumulator(): StreamAccumulator {
  const blocks: InternalBlock[] = []
  const order: string[] = []
  const index = new Map<string, number>()

  function upsert(block: InternalBlock, partId: string): void {
    const existing = index.get(partId)
    if (existing !== undefined) {
      blocks[existing] = block
    } else {
      order.push(partId)
      index.set(partId, blocks.length)
      blocks.push(block)
    }
  }

  function toContentBlocks(): ContentBlock[] {
    const result: ContentBlock[] = []
    for (const b of blocks) {
      if (b.type === 'text') result.push({ type: 'text', text: b.text })
      else if (b.type === 'tool') result.push({ type: 'tool', tool: b.tool ?? 'unknown', args: b.args, status: b.status })
      // reasoning is internal-only, excluded from public output
    }
    return result
  }

  return {
    update(parts) {
      for (const p of parts) {
        const partId = p.id

        if (p.type === 'text' && typeof p.text === 'string') {
          // Skip empty text overwrites — SDK sends text="" on some part.updated
          // events, which would erase previously accumulated text for this partId.
          if (p.text === '' && index.has(partId) && blocks[index.get(partId)!].type === 'text' && blocks[index.get(partId)!].text !== '') {
            continue
          }
          upsert({ type: 'text', partId, text: p.text, args: '', status: 'done' }, partId)
        }

        if (p.type === 'tool' && typeof p.tool === 'string') {
          upsert({
            type: 'tool',
            partId,
            tool: p.tool,
            text: '',
            args: p.args ?? '',
            status: p.status ?? 'running',
          }, partId)
        }

        if (p.type === 'reasoning' && typeof p.text === 'string') {
          upsert({ type: 'reasoning', partId, text: p.text, args: '', status: 'done' }, partId)
        }
      }
      return toContentBlocks()
    },

    finalize() {
      return toContentBlocks()
    },

    getText() {
      let out = ''
      for (const b of blocks) {
        if (b.type === 'text') out += b.text
      }
      return out
    },

    getTools() {
      return blocks.filter(b => b.type === 'tool').map(b => ({ type: 'tool' as const, tool: b.tool ?? 'unknown', args: b.args, status: b.status }))
    },

    reset() {
      blocks.length = 0
      order.length = 0
      index.clear()
    },
  }
}
