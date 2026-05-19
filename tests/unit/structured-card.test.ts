import { describe, it, expect } from 'vitest'
import type { StructuredCard, AssistantMeta } from '../../src/core/structured-card'

describe('StructuredCard', () => {
  it('thinking has sessionId and showStop', () => {
    const c: StructuredCard = { kind: 'thinking', sessionId: 'ses_1', showStop: true }
    expect(c.kind).toBe('thinking')
  })

  it('streaming carries blocks', () => {
    const c: StructuredCard = { kind: 'streaming', sessionId: 'ses_1', blocks: [
      { type: 'tool', tool: 'bash', args: 'ls', status: 'done' as const },
      { type: 'text', text: 'hi' },
    ]}
    expect(c.blocks[0].type).toBe('tool')
    expect(c.blocks[1].type).toBe('text')
  })

  it('assistant carries meta', () => {
    const meta: AssistantMeta = { agent: 'build', model: 'k2p6', cost: 0.04 }
    const c: StructuredCard = { kind: 'assistant', sessionId: 'ses_1', blocks: [{ type: 'text', text: 'done' }], meta }
    expect(c.meta.cost).toBe(0.04)
  })
})
