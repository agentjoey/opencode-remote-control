import { describe, it, expect } from 'vitest'
import { parseBackendsSpec } from '../../src/cli/host-backends'

describe('parseBackendsSpec', () => {
  it('falls back to a single ACP backend from OCRC_ACP_CMD when empty', () => {
    expect(parseBackendsSpec('', 'kimi acp')).toEqual([{ id: 'acp:kimi', kind: 'acp', command: 'kimi acp' }])
  })

  it('parses opencode + a named acp backend', () => {
    expect(parseBackendsSpec('opencode, kimi=kimi acp', 'x')).toEqual([
      { id: 'opencode', kind: 'opencode' },
      { id: 'acp:kimi', kind: 'acp', command: 'kimi acp' },
    ])
  })

  it('keeps an id that already has a namespace prefix', () => {
    expect(parseBackendsSpec('acp:gemini=gemini --acp', 'x')).toEqual([
      { id: 'acp:gemini', kind: 'acp', command: 'gemini --acp' },
    ])
  })

  it('treats a bare command (no =) as an acp backend keyed by its binary', () => {
    expect(parseBackendsSpec('gemini --acp', 'x')).toEqual([
      { id: 'acp:gemini', kind: 'acp', command: 'gemini --acp' },
    ])
  })

  it('ignores blank entries and whitespace', () => {
    expect(parseBackendsSpec(' opencode ,  , kimi=kimi acp ', 'x').map((b) => b.id)).toEqual(['opencode', 'acp:kimi'])
  })
})
