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

/** Minimal subset of SDK Part fields that the accumulator needs. */
export interface PartInput {
  id: string
  type: 'text' | 'tool' | 'reasoning' | string
  text?: string
  tool?: string
  state?: { status?: string; input?: Record<string, unknown> }
}

export function createStreamAccumulator(): StreamAccumulator {
  const blocks: InternalBlock[] = []
  const order: string[] = []
  const index = new Map<string, number>()

  function summarizeArgs(tool: string, input?: Record<string, unknown>): string {
    if (!input) return ''
    if (tool === 'bash' && typeof input.cmd === 'string') {
      return input.cmd.length > 60 ? input.cmd.slice(0, 57) + '...' : input.cmd
    }
    const keys = Object.keys(input)
    if (keys.length === 0) return ''
    const first = String(input[keys[0]])
    return first.length > 60 ? first.slice(0, 57) + '...' : first
  }

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
          upsert({ type: 'text', partId, text: p.text, args: '', status: 'done' }, partId)
        }

        if (p.type === 'tool' && typeof p.tool === 'string') {
          const status = p.state?.status ?? 'running'
          const mapped: InternalBlock['status'] =
            status === 'error' ? 'error' :
            status === 'done' || status === 'completed' ? 'done' :
            'running'
          upsert({
            type: 'tool',
            partId,
            tool: p.tool,
            text: '',
            args: summarizeArgs(p.tool, p.state?.input),
            status: mapped,
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
