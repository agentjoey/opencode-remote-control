import { describe, it, expect } from 'vitest'
import { buildReplayCards } from '../../../src/core/agent/acp-replay'

const U = (text: string) => ({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text } })
const A = (text: string) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
const TC = (id: string, title: string, status: string) => ({ sessionUpdate: 'tool_call', toolCallId: id, title, status })
const TCU = (id: string, status: string) => ({ sessionUpdate: 'tool_call_update', toolCallId: id, status })

describe('buildReplayCards', () => {
  it('groups a replayed stream into user + assistant cards (text + tools)', () => {
    const cards = buildReplayCards('s1', [
      U('hello'), A('Hi! Let me check.'), TC('t1', 'Bash', 'in_progress'), TCU('t1', 'completed'),
      A(' Done.'), U('thanks'), A('np'),
    ] as any, 1000)
    expect(cards.map((c) => c.kind)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(cards[0]).toMatchObject({ kind: 'user', text: 'hello', ts: 1000 })
    const a1 = cards[1] as any
    // text spans both agent chunks (split by the tool); the tool block sits between
    expect(a1.blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')).toBe('Hi! Let me check. Done.')
    expect(a1.blocks.find((b: any) => b.type === 'tool')).toMatchObject({ tool: 'Bash', status: 'done' })
    expect(cards[2]).toMatchObject({ kind: 'user', text: 'thanks' })
  })

  it('merges consecutive user chunks, ignores thoughts, and tolerates empty input', () => {
    expect(buildReplayCards('s', [], 0)).toEqual([])
    const cards = buildReplayCards('s', [
      U('multi '), U('line'),
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking…' } },
      A('answer'),
    ] as any, 0)
    expect(cards.map((c) => c.kind)).toEqual(['user', 'assistant'])
    expect((cards[0] as any).text).toBe('multi line')
    expect((cards[1] as any).blocks).toEqual([{ type: 'text', text: 'answer' }])
  })
})
