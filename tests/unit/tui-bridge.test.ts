import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TuiBridge } from '../../src/opencode/tui-bridge'

function fakeClient(sessions: Array<{ id: string; time?: { created?: number } }>) {
  return {
    session: {
      list: async () => ({ data: sessions }),
    },
  } as any
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

describe('TuiBridge.submit', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('submits to the picked session and returns its id (HTTP 204)', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) {
        return { ok: true, json: async () => ({}) } as Response
      }
      if (/\/session\/ses_target\/prompt_async$/.test(url)) {
        return { ok: true, status: 204 } as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    expect(await b.submit('hello')).toBe('ses_target')
  })

  it('uses sessionIdOverride when provided', async () => {
    const client = fakeClient([{ id: 'newest', time: { created: 200 } }])
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) {
        return { ok: true, json: async () => ({}) } as Response
      }
      if (/\/session\/forced\/prompt_async$/.test(url)) {
        return { ok: true, status: 204 } as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const b = new TuiBridge('http://localhost:4096', client)
    expect(await b.submit('hello', 'forced')).toBe('forced')
  })

  it('throws session_busy when target session is currently busy', async () => {
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

  it('throws submit_rejected on HTTP error', async () => {
    const client = fakeClient([{ id: 'ses_target', time: { created: 100 } }])
    const fetchMock = vi.fn(async (url: string) => {
      if (/\/session\/status$/.test(url)) {
        return { ok: true, json: async () => ({}) } as Response
      }
      if (/\/prompt_async$/.test(url)) {
        return { ok: false, status: 500 } as Response
      }
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
})
