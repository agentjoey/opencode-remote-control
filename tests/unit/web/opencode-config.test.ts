import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchOpencodeConfig } from '../../../src/transport/web/opencode-config'

afterEach(() => vi.unstubAllGlobals())

describe('fetchOpencodeConfig', () => {
  it('GETs <baseUrl>/config and returns parsed JSON', async () => {
    const json = { mcp: { github: { type: 'remote' } }, agent: {} }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => json }))
    const out = await fetchOpencodeConfig('http://localhost:4096', '/config')
    expect((global.fetch as any).mock.calls[0][0]).toBe('http://localhost:4096/config')
    expect(out).toEqual(json)
  })

  it('returns {} when baseUrl is empty or the fetch fails', async () => {
    expect(await fetchOpencodeConfig('', '/config')).toEqual({})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    expect(await fetchOpencodeConfig('http://localhost:4096', '/config')).toEqual({})
  })
})
