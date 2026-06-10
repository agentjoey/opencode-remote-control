import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, setBaseUrl, setAuthHeaders } from './client.js'

describe('api client auth headers', () => {
  beforeEach(() => {
    setBaseUrl('https://bot.example.com')
    setAuthHeaders(() => ({}))
  })
  afterEach(() => {
    setAuthHeaders(() => ({})) // reset for other suites
    vi.unstubAllGlobals()
  })

  it('injects auth headers on GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'x' }) })
    vi.stubGlobal('fetch', fetchMock)
    setAuthHeaders(() => ({ 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'sec' }))

    await api.me()

    const [, init] = fetchMock.mock.calls[0]
    expect(init.credentials).toBe('include')
    expect(init.headers['CF-Access-Client-Id']).toBe('id')
    expect(init.headers['CF-Access-Client-Secret']).toBe('sec')
  })

  it('injects auth headers on POST alongside content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    setAuthHeaders(() => ({ 'CF-Access-Client-Id': 'id' }))

    await api.abort('ses_1')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.headers['CF-Access-Client-Id']).toBe('id')
  })

  it('sends no extra headers when the injector is empty (PWA cookie path)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'x' }) })
    vi.stubGlobal('fetch', fetchMock)

    await api.me()

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['CF-Access-Client-Id']).toBeUndefined()
    expect(init.credentials).toBe('include')
  })
})
