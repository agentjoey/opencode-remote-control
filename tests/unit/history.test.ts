import { describe, it, expect, vi } from 'vitest'
import { messageToCards, reconstructHistory, summarizeToolArgs } from '../../src/core/history'
import type { OpencodeClient } from '@opencode-ai/sdk'

describe('messageToCards', () => {
  it('converts user message to user card', () => {
    const msg = { role: 'user', parts: [{ type: 'text', text: 'hello' }], ts: 1234567890 }
    const cards = messageToCards('ses_1', msg)
    expect(cards).toHaveLength(1)
    expect(cards[0].kind).toBe('user')
    expect((cards[0] as any).text).toBe('hello')
    expect((cards[0] as any).sessionId).toBe('ses_1')
  })

  it('converts assistant message with tools and meta', () => {
    const msg = {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'done' },
        // opencode's real terminal status is 'completed' (never 'done').
        { type: 'tool', tool: 'bash', state: { input: { command: 'ls -la' }, status: 'completed' } }
      ],
      agent: { name: 'build' },
      model: 'k2p6',
      cost: 0.04,
      tokens: { input: 100, output: 50 }
    }
    const cards = messageToCards('ses_1', msg)
    expect(cards).toHaveLength(1)
    expect(cards[0].kind).toBe('assistant')
    const c = cards[0] as any
    expect(c.blocks).toHaveLength(2)
    expect(c.blocks[0].type).toBe('text')
    expect(c.blocks[0].text).toBe('done')
    expect(c.blocks[1].type).toBe('tool')
    expect(c.blocks[1].tool).toBe('bash')
    expect(c.blocks[1].args).toBe('ls -la')
    expect(c.blocks[1].status).toBe('done')
    expect(c.meta.agent).toBe('build')
    expect(c.meta.model).toBe('k2p6')
    expect(c.meta.cost).toBe(0.04)
    expect(c.meta.tokens).toEqual({ input: 100, output: 50 })
  })

  it('converts assistant message without meta to assistant kind', () => {
    const msg = {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'partial' },
        { type: 'tool', tool: 'bash', state: { input: { command: 'pwd' }, status: 'running' } }
      ]
    }
    const cards = messageToCards('ses_1', msg)
    expect(cards[0].kind).toBe('assistant')
    const c = cards[0] as any
    expect(c.blocks).toHaveLength(2)
    expect(c.blocks[0].text).toBe('partial')
    expect(c.blocks[1].type).toBe('tool')
    expect(c.blocks[1].status).toBe('running')
  })

  it('maps every opencode tool status to our tri-state (regression: finished tools must not stay running)', () => {
    const mk = (status: string) => {
      const cards = messageToCards('ses_1', {
        role: 'assistant',
        parts: [{ type: 'tool', tool: 'bash', state: { input: {}, status } }],
      })
      return (cards[0] as any).blocks[0].status
    }
    expect(mk('completed')).toBe('done')
    expect(mk('done')).toBe('done')
    expect(mk('error')).toBe('error')
    expect(mk('running')).toBe('running')
    expect(mk('pending')).toBe('running')
  })
})

describe('summarizeToolArgs', () => {
  it('truncates bash commands to 60 chars', () => {
    const longCmd = 'a'.repeat(100)
    expect(summarizeToolArgs('bash', { command: longCmd })).toBe(longCmd.slice(0, 60))
  })

  it('extracts file path for read/edit/write', () => {
    expect(summarizeToolArgs('read', { filePath: '/tmp/test.ts' })).toBe('/tmp/test.ts')
    expect(summarizeToolArgs('edit', { filePath: 'src/index.ts' })).toBe('src/index.ts')
    expect(summarizeToolArgs('write', { filePath: 'README.md' })).toBe('README.md')
  })

  it('extracts pattern for grep/find', () => {
    expect(summarizeToolArgs('grep', { pattern: 'TODO' })).toBe('TODO')
    expect(summarizeToolArgs('find', { query: '*.ts' })).toBe('*.ts')
  })
})

describe('reconstructHistory', () => {
  it('returns flattened cards from mocked session messages', async () => {
    const mockClient = {
      session: {
        messages: vi.fn().mockResolvedValue({
          data: [
            { role: 'user', parts: [{ type: 'text', text: 'hello' }], ts: 1234567890 },
            { role: 'assistant', parts: [{ type: 'text', text: 'hi' }], agent: { name: 'build' } }
          ]
        })
      }
    } as unknown as OpencodeClient

    const cards = await reconstructHistory(mockClient, 'ses_1')
    expect(cards).toHaveLength(2)
    expect(cards[0].kind).toBe('user')
    expect(cards[1].kind).toBe('assistant')
  })
})
