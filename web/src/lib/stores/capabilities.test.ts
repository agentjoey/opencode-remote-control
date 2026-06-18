import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { capabilities, loadCapabilities, can, canActive, backends, viewedSessionId, currentBackendId } from './capabilities.js'
import { sessionList } from './sessions.js'
import { api } from '../api/client.js'

vi.mock('../api/client.js', () => ({
  api: { capabilities: vi.fn() }
}))

describe('capabilities store', () => {
  beforeEach(() => {
    capabilities.set(null)
    backends.set(null)
    viewedSessionId.set(undefined)
    sessionList.set([])
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

  describe('multi-backend per-session gating', () => {
    const TWO = {
      activeId: 'opencode',
      backends: [
        { id: 'opencode', capabilities: { workspaces: true, diff: true } },
        { id: 'acp:kimi', capabilities: { workspaces: false, diff: false } },
      ],
    }

    it('can() reflects the VIEWED session’s backend, not the active one', () => {
      backends.set(TWO)
      sessionList.set([
        { id: 'o1', backendId: 'opencode' } as any,
        { id: 'k1', backendId: 'acp:kimi' } as any,
      ])
      viewedSessionId.set('k1')
      expect(get(can)('diff')).toBe(false) // kimi session
      viewedSessionId.set('o1')
      expect(get(can)('diff')).toBe(true) // opencode session
      expect(get(currentBackendId)).toBe('opencode')
    })

    it('canActive() reflects the ACTIVE backend regardless of the viewed session', () => {
      backends.set({ ...TWO, activeId: 'acp:kimi' })
      sessionList.set([{ id: 'o1', backendId: 'opencode' } as any])
      viewedSessionId.set('o1') // viewing an opencode session
      expect(get(can)('workspaces')).toBe(true) // viewed = opencode
      expect(get(canActive)('workspaces')).toBe(false) // active = kimi
    })

    it('untagged/unknown viewed session falls back to the active backend', () => {
      backends.set(TWO)
      sessionList.set([])
      viewedSessionId.set('ghost')
      expect(get(currentBackendId)).toBe('opencode')
      expect(get(can)('diff')).toBe(true)
    })
  })
})
