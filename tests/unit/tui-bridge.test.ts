import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TuiBridge } from '../../src/opencode/tui-bridge'

describe('TuiBridge.submit', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function mockFetch(responses: Array<{ url: RegExp; body: any }>) {
    return vi.fn(async (url: string) => {
      const match = responses.shift()
      if (!match || !match.url.test(url)) {
        throw new Error(`Unexpected fetch to ${url}; remaining=${JSON.stringify(responses)}`)
      }
      return { ok: true, json: async () => match.body } as Response
    })
  }

  it('returns sessionID of newly busy session', async () => {
    const fetchMock = mockFetch([
      { url: /\/session\/status$/, body: {} }, // before: empty
      { url: /\/tui\/submit-prompt$/, body: true },
      { url: /\/session\/status$/, body: { ses_new: { type: 'busy' } } }, // after: new busy
    ])
    vi.stubGlobal('fetch', fetchMock)

    const bridge = new TuiBridge('http://localhost:4096')
    const sid = await bridge.submit('hello', { deadlineMs: 1000, intervalMs: 10 })
    expect(sid).toBe('ses_new')
  })

  it('skips sessions that were already busy before submit', async () => {
    const fetchMock = mockFetch([
      { url: /\/session\/status$/, body: { ses_old: { type: 'busy' } } }, // before
      { url: /\/tui\/submit-prompt$/, body: true },
      { url: /\/session\/status$/, body: { ses_old: { type: 'busy' }, ses_new: { type: 'busy' } } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const bridge = new TuiBridge('http://localhost:4096')
    const sid = await bridge.submit('hello', { deadlineMs: 1000, intervalMs: 10 })
    expect(sid).toBe('ses_new')
  })

  it('throws TuiBusyError when before-set is non-empty and no new session appears', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({ ses_old: { type: 'busy' } }) } as Response
      if (/\/tui\/submit-prompt$/.test(url)) return { ok: true, json: async () => true } as Response
      throw new Error('unexpected')
    })
    vi.stubGlobal('fetch', fetchMock)

    const bridge = new TuiBridge('http://localhost:4096')
    await expect(bridge.submit('hello', { deadlineMs: 100, intervalMs: 10 })).rejects.toMatchObject({
      reason: 'tui_busy',
    })
  })

  it('throws TuiNotRunningError when before-set is empty and no new session appears', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({}) } as Response
      if (/\/tui\/submit-prompt$/.test(url)) return { ok: true, json: async () => true } as Response
      throw new Error('unexpected')
    })
    vi.stubGlobal('fetch', fetchMock)

    const bridge = new TuiBridge('http://localhost:4096')
    await expect(bridge.submit('hello', { deadlineMs: 100, intervalMs: 10 })).rejects.toMatchObject({
      reason: 'tui_not_running',
    })
  })

  it('throws when /tui/submit-prompt does not return true', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({}) } as Response
      if (/\/tui\/submit-prompt$/.test(url)) return { ok: true, json: async () => false } as Response
      throw new Error('unexpected')
    })
    vi.stubGlobal('fetch', fetchMock)

    const bridge = new TuiBridge('http://localhost:4096')
    await expect(bridge.submit('hello', { deadlineMs: 100, intervalMs: 10 })).rejects.toThrow(/rejected/)
  })
})
