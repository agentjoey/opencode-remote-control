import { describe, it, expect } from 'vitest'
import { createStreamAccumulator } from '../../src/core/stream-accumulator'

const textPart = (id: string, text: string): { id: string; type: 'text'; text: string } =>
  ({ id, type: 'text', text })

const toolPart = (id: string, tool: string, args: string, status: string): { id: string; type: 'tool'; tool: string; state: { status: string; input: Record<string, unknown> } } =>
  ({ id, type: 'tool', tool, state: { status, input: { cmd: args } } })

const reasoningPart = (id: string, text: string): { id: string; type: 'reasoning'; text: string } =>
  ({ id, type: 'reasoning', text })

const blockText = (b: any) => b.text ?? ''
const blockTool = (b: any) => b.tool ?? ''

describe('StreamAccumulator', () => {
  it('tracks text part by id and replaces on re-delivery', () => {
    const acc = createStreamAccumulator()
    acc.update([textPart('part_a', 'Hello')])
    acc.update([textPart('part_a', 'Hello world')])
    const blocks = acc.finalize()
    expect(blocks).toHaveLength(1)
    expect(blockText(blocks[0])).toBe('Hello world')
  })

  it('orders blocks by first-seen order', () => {
    const acc = createStreamAccumulator()
    acc.update([textPart('part_b', 'Second')])
    acc.update([textPart('part_a', 'First')])
    const blocks = acc.finalize()
    expect(blocks).toHaveLength(2)
    expect(blockText(blocks[0])).toBe('Second')
    expect(blockText(blocks[1])).toBe('First')
  })

  it('returns empty array when nothing accumulated', () => {
    const acc = createStreamAccumulator()
    expect(acc.finalize()).toEqual([])
  })

  it('getText concatenates all text blocks in insertion order', () => {
    const acc = createStreamAccumulator()
    acc.update([textPart('p1', 'A')])
    acc.update([textPart('p2', 'B')])
    acc.update([textPart('p1', 'A+')])
    expect(acc.getText()).toBe('A+B')
  })

  it('updates tool status for same part id', () => {
    const acc = createStreamAccumulator()
    acc.update([toolPart('tool_1', 'bash', 'ls -la', 'running')])
    acc.update([toolPart('tool_1', 'bash', 'ls -la', 'done')])
    const blocks = acc.finalize()
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as any).status).toBe('done')
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
    expect((blocks[1] as any).status).toBe('done')
  })

  it('reasoning blocks are internal-only (stripped from output)', () => {
    const acc = createStreamAccumulator()
    acc.update([reasoningPart('r1', 'I need to think...')])
    // reasoning is stripped from ContentBlock output — only text/tool survive
    const blocks = acc.finalize()
    expect(blocks).toHaveLength(0)
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
    expect(blockText(r1[0])).toBe('A')
    expect(blockText(r2[0])).toBe('AB')
  })
})
