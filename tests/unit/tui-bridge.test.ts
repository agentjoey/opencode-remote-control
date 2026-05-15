import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TuiBridge } from '../../src/opencode/tui-bridge'

function fakeClient(sessions: Array<{ id: string; time?: { created?: number } }>) {
  return {
    session: {
      list: async () => ({ data: sessions }),
    },
  } as any
}

/** Build a fetch mock that handles TUI inject endpoints (all succeeding). */
function tuiSuccessFetch(sessionId: string) {
  let statusCalls = 0
  return vi.fn(async (url: string) => {
    if (/\/session\/status$/.test(url)) {
      statusCalls++
      // First call (pre-submit busy check): not busy
      // Subsequent calls (post-submit waitForBusy poll): busy
      const body = statusCalls === 1 ? {} : { [sessionId]: { type: 'busy' } }
      return { ok: true, json: async () => body } as Response
    }
    if (/\/tui\/select-session$/.test(url)) {
      return { ok: true, json: async () => true } as Response
    }
    if (/\/tui\/clear-prompt$/.test(url)) {
      return { ok: true, json: async () => true } as Response
    }
    if (/\/tui\/append-prompt$/.test(url)) {
      return { ok: true, json: async () => true } as Response
    }
    if (/\/tui\/submit-prompt$/.test(url)) {
      return { ok: true, json: async () => true } as Response
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

describe('TuiBridge.pickSession', () => {
  it('returns the newest session by time.created', async () => {
    const client = fakeClient([
      { id: 'a', time: { created: 100 } },
      { id: 'b', time: { created: 300 } },
      { id: 'c', time: { created: 200 } },
    ])
    const b = new TuiBridge('http://localhost:4096', client)
    expect(await b.pickSession()).toBe('b')
  })

  it('uses override when provided', async () => {
    const b = new TuiBridge('http://localhost:4096', fakeClient([]))
    expect(await b.pickSession('forced-id')).toBe('forced-id')
  })

  it('throws no_session when list is empty', async () => {
    const b = new TuiBridge('http://localhost:4096', fakeClient([]))
    await expect(b.pickSession()).rejects.toMatchObject({ reason: 'no_session' })
  })

  it('handles missing time.created as 0', async () => {
    const client = fakeClient([
      { id: 'a', time: { created: 100 } },
      { id: 'b' }, // no time
    ])
    const b = new TuiBridge('http://localhost:4096', client)
    expect(await b.pickSession()).toBe('a')
  })
})

describe('TuiBridge.submit — TUI inject path', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('uses TUI inject (select→clear→append→submit) and returns session id', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    const fetchMock = tuiSuccessFetch('ses_target')
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    expect(await b.submit('hello')).toBe('ses_target')

    const urls = fetchMock.mock.calls.map((c) => c[0] as string)
    expect(urls).toContain('http://localhost:4096/tui/select-session')
    expect(urls).toContain('http://localhost:4096/tui/clear-prompt')
    expect(urls).toContain('http://localhost:4096/tui/append-prompt')
    expect(urls).toContain('http://localhost:4096/tui/submit-prompt')
    // prompt_async should NOT be called on TUI inject success
    expect(urls.some((u) => u.includes('prompt_async'))).toBe(false)
  })

  it('uses sessionIdOverride with TUI inject', async () => {
    const client = fakeClient([{ id: 'newest', time: { created: 200 } }])
    const fetchMock = tuiSuccessFetch('forced')
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    expect(await b.submit('hello', 'forced')).toBe('forced')

    const body = JSON.parse(fetchMock.mock.calls.find((c) => /select-session/.test(c[0] as string))![1]!.body as string)
    expect(body.sessionID).toBe('forced')
  })

  it('falls back to prompt_async when select-session returns non-ok', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({}) } as Response
      if (/\/tui\/select-session$/.test(url)) return { ok: false, status: 503 } as Response
      if (/\/prompt_async$/.test(url)) return { ok: true, status: 204 } as Response
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    expect(await b.submit('hello')).toBe('ses_target')
    const urls = fetchMock.mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.includes('prompt_async'))).toBe(true)
  })

  it('falls back to prompt_async when append-prompt returns false', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({}) } as Response
      if (/\/tui\/select-session$/.test(url)) return { ok: true, json: async () => true } as Response
      if (/\/tui\/clear-prompt$/.test(url)) return { ok: true, json: async () => true } as Response
      if (/\/tui\/append-prompt$/.test(url)) return { ok: true, json: async () => false } as Response
      if (/\/prompt_async$/.test(url)) return { ok: true, status: 204 } as Response
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    expect(await b.submit('hello')).toBe('ses_target')
    const urls = fetchMock.mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.includes('prompt_async'))).toBe(true)
  })

  it('falls back to prompt_async when no TUI is attached (session never goes busy)', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    const fetchMock = vi.fn(async (url: string) => {
      // session/status always returns empty — no TUI consuming the queue
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({}) } as Response
      if (/\/tui\/select-session$/.test(url)) return { ok: true, json: async () => true } as Response
      if (/\/tui\/clear-prompt$/.test(url)) return { ok: true, json: async () => true } as Response
      if (/\/tui\/append-prompt$/.test(url)) return { ok: true, json: async () => true } as Response
      if (/\/tui\/submit-prompt$/.test(url)) return { ok: true, json: async () => true } as Response
      if (/\/prompt_async$/.test(url)) return { ok: true, status: 204 } as Response
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    // Override the wait window so the test stays fast
    ;(b as unknown as { waitForBusy: (id: string, ms: number) => Promise<boolean> }).waitForBusy =
      async () => false
    expect(await b.submit('hello')).toBe('ses_target')
    const urls = fetchMock.mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.includes('prompt_async'))).toBe(true)
  })

  it('clears prompt and falls back when submit-prompt returns non-ok', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    let clearCalls = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({}) } as Response
      if (/\/tui\/select-session$/.test(url)) return { ok: true, json: async () => true } as Response
      if (/\/tui\/clear-prompt$/.test(url)) { clearCalls++; return { ok: true, json: async () => true } as Response }
      if (/\/tui\/append-prompt$/.test(url)) return { ok: true, json: async () => true } as Response
      if (/\/tui\/submit-prompt$/.test(url)) return { ok: false, status: 503 } as Response
      if (/\/prompt_async$/.test(url)) return { ok: true, status: 204 } as Response
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    expect(await b.submit('hello')).toBe('ses_target')
    // clear-prompt called twice: once before append, once as cleanup after submit fail
    expect(clearCalls).toBe(2)
  })
})

describe('TuiBridge.submit — error cases', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('throws session_busy before any TUI call', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) {
        return { ok: true, json: async () => ({ ses_target: { type: 'busy' } }) } as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    await expect(b.submit('hello')).rejects.toMatchObject({ reason: 'session_busy' })
  })

  it('throws submit_rejected when prompt_async fallback also fails', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({}) } as Response
      if (/\/tui\/select-session$/.test(url)) return { ok: false, status: 503 } as Response
      if (/\/prompt_async$/.test(url)) return { ok: false, status: 500 } as Response
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    await expect(b.submit('hello')).rejects.toMatchObject({ reason: 'submit_rejected' })
  })

  it('propagates no_session when no override and list is empty', async () => {
    const client = fakeClient([])
    const b = new TuiBridge('http://localhost:4096', client)
    await expect(b.submit('hello')).rejects.toMatchObject({ reason: 'no_session' })
  })

  it('throws unreachable when prompt_async fallback network error occurs', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) return { ok: true, json: async () => ({}) } as Response
      if (/\/tui\/select-session$/.test(url)) return { ok: false, status: 503 } as Response
      if (/\/prompt_async$/.test(url)) throw new TypeError('fetch failed')
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    await expect(b.submit('hello')).rejects.toMatchObject({ reason: 'unreachable' })
  })

  it('throws unreachable when getStatus network error occurs', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed') })
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    await expect(b.submit('hello')).rejects.toMatchObject({ reason: 'unreachable' })
  })
})
