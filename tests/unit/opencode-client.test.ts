import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkHealth } from '../../src/opencode/client'

describe('checkHealth', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when /global/health returns healthy: true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ healthy: true, version: '1.14.50' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const ok = await checkHealth('http://localhost:4096')
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4096/global/health')
  })

  it('returns false when /global/health responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await checkHealth('http://localhost:4096')).toBe(false)
  })

  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('econnrefused')))
    expect(await checkHealth('http://localhost:4096')).toBe(false)
  })

  it('returns false when healthy flag is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.14.50' }),
    }))
    expect(await checkHealth('http://localhost:4096')).toBe(false)
  })
})
