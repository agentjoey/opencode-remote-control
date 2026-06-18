import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { capabilities, loadCapabilities, can } from './capabilities.js'
import { api } from '../api/client.js'

vi.mock('../api/client.js', () => ({
  api: { capabilities: vi.fn() }
}))

describe('capabilities store', () => {
  beforeEach(() => {
    capabilities.set(null)
    vi.mocked(api.capabilities).mockReset()
  })

  it('starts empty', () => {
    expect(get(capabilities)).toBeNull()
  })

  it('loads backend id and capabilities from /api/capabilities', async () => {
    vi.mocked(api.capabilities).mockResolvedValue({ id: 'opencode', capabilities: { liveMirror: true } })
    await loadCapabilities()
    expect(get(capabilities)).toEqual({ id: 'opencode', capabilities: { liveMirror: true } })
  })

  it('survives a load error without crashing', async () => {
    vi.mocked(api.capabilities).mockRejectedValue(new Error('nope'))
    await expect(loadCapabilities()).resolves.toBeUndefined()
    expect(get(capabilities)).toBeNull()
  })

  describe('can() gate', () => {
    it('assumes supported when capabilities are unloaded', () => {
      capabilities.set(null)
      expect(get(can)('diff')).toBe(true)
    })

    it('returns false only when a flag is explicitly off (ACP backend)', () => {
      capabilities.set({ id: 'acp:kimi', capabilities: { workspaces: false, diff: false, catalog: false } })
      const gate = get(can)
      expect(gate('workspaces')).toBe(false)
      expect(gate('diff')).toBe(false)
      expect(gate('catalog')).toBe(false)
      // a flag the backend didn't report → assume supported
      expect(gate('unknownFeature')).toBe(true)
    })

    it('returns true for flags the opencode backend reports on', () => {
      capabilities.set({ id: 'opencode', capabilities: { workspaces: true, diff: true } })
      expect(get(can)('workspaces')).toBe(true)
    })
  })
})
