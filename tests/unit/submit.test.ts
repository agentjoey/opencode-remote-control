import { describe, it, expect, vi } from 'vitest'
import { submitPrompt } from '../../src/opencode/submit'

function fakeClient() {
  return {
    session: {
      promptAsync: vi.fn().mockResolvedValue({ data: {} }),
    },
  } as any
}

describe('submitPrompt', () => {
  it('passes text and sessionId to client.session.promptAsync', async () => {
    const client = fakeClient()
    await submitPrompt(client, { text: 'hello', sessionId: 'ses_1' })
    expect(client.session.promptAsync).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      body: { parts: [{ type: 'text', text: 'hello' }] },
      signal: undefined,
    })
  })

  it('includes agent override when provided', async () => {
    const client = fakeClient()
    await submitPrompt(client, { text: 'x', sessionId: 'ses_1', agent: 'build' })
    expect(client.session.promptAsync).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      body: { parts: [{ type: 'text', text: 'x' }], agent: 'build' },
      signal: undefined,
    })
  })

  it('includes model override when provided', async () => {
    const client = fakeClient()
    await submitPrompt(client, {
      text: 'x',
      sessionId: 'ses_1',
      model: { providerID: 'kimi-for-coding', modelID: 'k2p6' },
    })
    expect(client.session.promptAsync).toHaveBeenCalledWith({
      path: { id: 'ses_1' },
      body: {
        parts: [{ type: 'text', text: 'x' }],
        model: { providerID: 'kimi-for-coding', modelID: 'k2p6' },
      },
      signal: undefined,
    })
  })

  it('passes signal through', async () => {
    const client = fakeClient()
    const ac = new AbortController()
    await submitPrompt(client, { text: 'x', sessionId: 'ses_1', signal: ac.signal })
    expect(client.session.promptAsync).toHaveBeenCalledWith(expect.objectContaining({ signal: ac.signal }))
  })
})
