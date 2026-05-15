import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReplyStream } from '../../src/bot/reply'

function fakeCtx() {
  return {
    chat: { id: 100 },
    telegram: {
      editMessageText: vi.fn().mockResolvedValue(true),
    },
    reply: vi.fn().mockResolvedValue({ message_id: 999 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
  }
}

describe('createReplyStream.update', () => {
  beforeEach(() => vi.useFakeTimers())

  it('first update edits the status message', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 4000 })
    await stream.update('partial 1')
    expect(ctx.telegram.editMessageText).toHaveBeenCalledTimes(1)
    expect(ctx.telegram.editMessageText).toHaveBeenCalledWith(100, 42, undefined, 'partial 1')
  })

  it('rejects updates within throttle window', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 4000 })
    await stream.update('a')
    await stream.update('b')
    await stream.update('c')
    expect(ctx.telegram.editMessageText).toHaveBeenCalledTimes(1)
  })

  it('accepts update after throttle expires', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 4000 })
    await stream.update('a')
    vi.advanceTimersByTime(1100)
    await stream.update('b')
    expect(ctx.telegram.editMessageText).toHaveBeenCalledTimes(2)
  })

  it('truncates body to 4000 chars in update (Telegram editMessage limit)', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 0, maxLength: 4000 })
    await stream.update('x'.repeat(5000))
    const args = ctx.telegram.editMessageText.mock.calls[0]
    expect((args[3] as string).length).toBe(4000)
  })

  it('swallows editMessage errors silently', async () => {
    const ctx = fakeCtx()
    ctx.telegram.editMessageText = vi.fn().mockRejectedValue(new Error('400'))
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 0, maxLength: 4000 })
    await expect(stream.update('boom')).resolves.toBeUndefined()
  })
})

describe('createReplyStream.finalize', () => {
  beforeEach(() => vi.useRealTimers())

  it('deletes status then sends single reply when short', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 4000 })
    await stream.finalize('final short text')
    expect(ctx.deleteMessage).toHaveBeenCalledWith(42)
    expect(ctx.reply).toHaveBeenCalledTimes(1)
    expect(ctx.reply).toHaveBeenCalledWith('final short text')
  })

  it('chunks long output into multiple replies', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 5 })
    await stream.finalize('aaaaa\nbbbbb\nccccc')
    expect(ctx.reply.mock.calls.length).toBeGreaterThan(1)
  })

  it('replies "(empty response)" when text is blank', async () => {
    const ctx = fakeCtx()
    const stream = createReplyStream(ctx as any, 42, { throttleMs: 1000, maxLength: 4000 })
    await stream.finalize('')
    expect(ctx.reply).toHaveBeenCalledWith('(empty response)')
  })
})
