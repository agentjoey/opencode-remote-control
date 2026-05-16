import { describe, it, expect } from 'vitest'
import type { StructuredCard, ToolCall, AssistantMeta } from '../../src/core/structured-card'

describe('StructuredCard', () => {
  it('thinking has sessionId and showStop', () => {
    const c: StructuredCard = { kind: 'thinking', sessionId: 'ses_1', showStop: true }
    expect(c.kind).toBe('thinking')
  })

  it('streaming carries markdownSrc and tools', () => {
    const tools: ToolCall[] = [{ tool: 'bash', args: 'ls', status: 'done' }]
    const c: StructuredCard = { kind: 'streaming', sessionId: 'ses_1', markdownSrc: 'hi', tools }
    expect(c.tools[0].tool).toBe('bash')
  })

  it('assistant carries meta', () => {
    const meta: AssistantMeta = { agent: 'build', model: 'k2p6', cost: 0.04 }
    const c: StructuredCard = { kind: 'assistant', sessionId: 'ses_1', markdownSrc: 'done', tools: [], meta }
    expect(c.meta.cost).toBe(0.04)
  })
})
