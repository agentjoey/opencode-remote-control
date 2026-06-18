import { describe, it, expect } from 'vitest'
import { createAcpNormalizer, type AcpUpdate } from '../../../src/core/agent/acp-normalizer'

// Payloads mirror what live `kimi acp` (Kimi Code CLI 1.47.0) emits — see
// docs/ACP_BACKEND_DESIGN.md §12b.
const SID = 'a60cccd2-6fc2-498b-8db0-5335b2da14d4'

const msgChunk = (text: string): AcpUpdate => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
const thoughtChunk = (text: string): AcpUpdate => ({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } })
const toolCall = (id: string, status: string): AcpUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: id,
  title: 'Shell',
  status,
  content: [{ type: 'content', content: { type: 'text', text: '' } }],
})
const toolUpdate = (id: string, status: string): AcpUpdate => ({ sessionUpdate: 'tool_call_update', toolCallId: id, title: 'Shell', status })

describe('createAcpNormalizer', () => {
  it('emits a text part on the first message chunk, deltas thereafter', () => {
    const n = createAcpNormalizer()
    const e1 = n.normalize(SID, msgChunk('It'))
    const e2 = n.normalize(SID, msgChunk(' works'))
    expect(e1).toEqual({ kind: 'part', sessionId: SID, part: { id: `${SID}:text:0`, type: 'text', text: 'It' } })
    expect(e2).toEqual({ kind: 'delta', sessionId: SID, partId: `${SID}:text:0`, text: ' works' })
  })

  it('treats thought chunks as a separate reasoning part stream', () => {
    const n = createAcpNormalizer()
    const e1 = n.normalize(SID, thoughtChunk('The'))
    const e2 = n.normalize(SID, thoughtChunk(' plan'))
    expect(e1).toMatchObject({ kind: 'part', part: { type: 'reasoning', id: `${SID}:reasoning:0`, text: 'The' } })
    expect(e2).toMatchObject({ kind: 'delta', partId: `${SID}:reasoning:0`, text: ' plan' })
  })

  it('keeps text and reasoning part ids independent within a turn', () => {
    const n = createAcpNormalizer()
    expect(n.normalize(SID, thoughtChunk('think'))).toMatchObject({ kind: 'part', part: { type: 'reasoning' } })
    expect(n.normalize(SID, msgChunk('answer'))).toMatchObject({ kind: 'part', part: { type: 'text' } })
    // both now stream as deltas to their own ids
    expect(n.normalize(SID, thoughtChunk('+'))).toMatchObject({ kind: 'delta', partId: `${SID}:reasoning:0` })
    expect(n.normalize(SID, msgChunk('+'))).toMatchObject({ kind: 'delta', partId: `${SID}:text:0` })
  })

  it('reset bumps the turn so the next chunk starts a fresh part id', () => {
    const n = createAcpNormalizer()
    n.normalize(SID, msgChunk('turn one'))
    n.reset(SID)
    const e = n.normalize(SID, msgChunk('turn two'))
    expect(e).toEqual({ kind: 'part', sessionId: SID, part: { id: `${SID}:text:1`, type: 'text', text: 'turn two' } })
  })

  it('maps tool_call → running tool part keyed by toolCallId', () => {
    const n = createAcpNormalizer()
    const e = n.normalize(SID, toolCall('tc_1', 'in_progress'))
    expect(e).toMatchObject({ kind: 'part', part: { id: 'tc_1', type: 'tool', tool: 'Shell', status: 'running' } })
  })

  it('maps tool_call_update status transitions (completed → done, failed → error)', () => {
    const n = createAcpNormalizer()
    expect(n.normalize(SID, toolUpdate('tc_1', 'completed'))).toMatchObject({ part: { id: 'tc_1', status: 'done' } })
    expect(n.normalize(SID, toolUpdate('tc_2', 'failed'))).toMatchObject({ part: { id: 'tc_2', status: 'error' } })
  })

  it('ignores empty chunks and non-relay updates', () => {
    const n = createAcpNormalizer()
    expect(n.normalize(SID, msgChunk(''))).toBeNull()
    expect(n.normalize(SID, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'init' }] })).toBeNull()
    expect(n.normalize(SID, { sessionUpdate: 'tool_call' })).toBeNull() // no toolCallId
  })

  it('isolates turn state per session', () => {
    const n = createAcpNormalizer()
    n.normalize('ses_a', msgChunk('a'))
    const e = n.normalize('ses_b', msgChunk('b'))
    expect(e).toMatchObject({ kind: 'part', part: { id: 'ses_b:text:0' } })
  })
})
