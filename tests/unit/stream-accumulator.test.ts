import { describe, it, expect } from 'vitest'
import { createStreamAccumulator } from '../../src/core/stream-accumulator'
import type { TextBlock, ToolBlock, ReasoningBlock } from '../../src/core/stream-accumulator'

/**
 * Mimics SDK Part objects that relay extracts from EventMessagePartUpdated.
 * Part.text is the FULL content of that part — not a delta.
 */
const textPart = (id: string, text: string): { id: string; type: 'text'; text: string } =>
  ({ id, type: 'text', text })

const toolPart = (id: string, tool: string, args: string, status: ToolBlock['status']): { id: string; type: 'tool'; tool: string; state: { status: string; input: Record<string, unknown> } } =>
  ({ id, type: 'tool', tool, state: { status, input: { cmd: args } } })

const reasoningPart = (id: string, text: string): { id: string; type: 'reasoning'; text: string } =>
  ({ id, type: 'reasoning', text })

describe('StreamAccumulator', () => {
  it('tracks text part by id and replaces on re-delivery', () => {
    const acc = createStreamAccumulator()
    // First delivery: server sends part with full text "Hello"
    acc.update([textPart('part_a', 'Hello')])
    // Re-delivery: same part id, but text now includes more content
    acc.update([textPart('part_a', 'Hello world')])
    const blocks = acc.finalize()
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as TextBlock).text).toBe('Hello world')
  })

  it('orders blocks by first-seen order, not by part id', () => {
    const acc = createStreamAccumulator()
    acc.update([textPart('part_b', 'Second')])
    acc.update([textPart('part_a', 'First')])
    const blocks = acc.finalize()
    expect(blocks).toHaveLength(2)
    expect((blocks[0] as TextBlock).text).toBe('Second')   // part_b arrived first
    expect((blocks[1] as TextBlock).text).toBe('First')
  })

  it('returns empty array when nothing accumulated', () => {
    const acc = createStreamAccumulator()
    expect(acc.finalize()).toEqual([])
  })

  it('getText concatenates all text blocks in insertion order', () => {
    const acc = createStreamAccumulator()
    acc.update([textPart('p1', 'A')])
    acc.update([textPart('p2', 'B')])
    acc.update([textPart('p1', 'A+')]) // update p1
    expect(acc.getText()).toBe('A+B')
  })

  it('updates tool status for same part id', () => {
    const acc = createStreamAccumulator()
    acc.update([toolPart('tool_1', 'bash', 'ls -la', 'running')])
    acc.update([toolPart('tool_1', 'bash', 'ls -la', 'done')])
    const blocks = acc.finalize()
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as ToolBlock).status).toBe('done')
  })

  it('adds new tool block when part id differs', () => {
    const acc = createStreamAccumulator()
    acc.update([toolPart('t1', 'bash', 'ls', 'running')])
    acc.update([toolPart('t2', 'bash', 'git status', 'running')])
    expect(acc.finalize()).toHaveLength(2)
  })

  it('preserves interleaved text and tool order', () => {
    const acc = createStreamAccumulator()
    acc.update([textPart('p1', 'Let me check.')])
    acc.update([toolPart('t1', 'bash', 'ls', 'running')])
    acc.update([toolPart('t1', 'bash', 'ls', 'done')])
    acc.update([textPart('p2', 'Done!')])
    const blocks = acc.finalize()
    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('text')
    expect(blocks[1].type).toBe('tool')
    expect(blocks[2].type).toBe('text')
    expect((blocks[1] as ToolBlock).status).toBe('done')
  })

  it('accumulates reasoning text from same part id updates', () => {
    const acc = createStreamAccumulator()
    acc.update([reasoningPart('r1', 'I need to use Euclidean algorithm.\n')])
    acc.update([reasoningPart('r1', 'I need to use Euclidean algorithm.\n1071 = 2 × 462 + 147')])
    const blocks = acc.finalize()
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as ReasoningBlock).text).toContain('Euclidean')
    expect((blocks[0] as ReasoningBlock).text).toContain('1071 = 2 × 462 + 147')
  })

  it('reasoning and text blocks are separate', () => {
    const acc = createStreamAccumulator()
    acc.update([reasoningPart('r1', 'Let me think...')])
    acc.update([textPart('p1', 'Here is the answer.')])
    const blocks = acc.finalize()
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('reasoning')
    expect(blocks[1].type).toBe('text')
  })

  it('getText excludes reasoning blocks', () => {
    const acc = createStreamAccumulator()
    acc.update([reasoningPart('r1', 'Thinking...')])
    acc.update([textPart('p1', 'Answer')])
    expect(acc.getText()).toBe('Answer')
  })

  it('reset clears all state', () => {
    const acc = createStreamAccumulator()
    acc.update([textPart('p1', 'hello')])
    acc.reset()
    expect(acc.finalize()).toEqual([])
    expect(acc.getText()).toBe('')
  })

  it('update returns snapshot without mutating previous references', () => {
    const acc = createStreamAccumulator()
    const r1 = acc.update([textPart('p1', 'A')])
    const r2 = acc.update([textPart('p1', 'AB')])
    expect((r1[0] as TextBlock).text).toBe('A')
    expect((r2[0] as TextBlock).text).toBe('AB')
  })
})
