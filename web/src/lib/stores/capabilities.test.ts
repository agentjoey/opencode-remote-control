import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { capabilities, loadCapabilities } from './capabilities.js'
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
})
