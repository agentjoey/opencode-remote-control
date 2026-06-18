import { describe, it, expect, beforeEach } from 'vitest'
import { createBackendRegistry } from '../../../src/core/agent/registry'
import type { AgentBackend, BackendCapabilities } from '../../../src/core/agent/backend'

const caps = (over: Partial<BackendCapabilities> = {}): BackendCapabilities => ({
  liveMirror: false, tuiSelect: false, workspaces: false, diff: false, todos: false, catalog: false, mcp: false, commands: false, ...over,
})
const fakeBackend = (id: string, c?: Partial<BackendCapabilities>): AgentBackend =>
  ({ id, capabilities: caps(c) } as unknown as AgentBackend)

/** Minimal in-memory SessionState slice the registry touches. */
function fakeState() {
  const sb = new Map<string, string>()
  let active: string | undefined
  return {
    getSessionBackend: (sid: string) => sb.get(sid),
    setSessionBackend: (sid: string, id: string | undefined) => { if (id === undefined) sb.delete(sid); else sb.set(sid, id) },
    getActiveBackend: () => active,
    setActiveBackend: (id: string | undefined) => { active = id },
  } as any
}

describe('createBackendRegistry', () => {
  let state: ReturnType<typeof fakeState>
  beforeEach(() => { state = fakeState() })

  const make = (primaryId?: string) => createBackendRegistry({
    state,
    primaryId,
    backends: [
      { id: 'opencode', backend: fakeBackend('opencode', { workspaces: true, diff: true }) },
      { id: 'acp:kimi', backend: fakeBackend('acp:kimi') },
    ],
  })

  it('throws with no backends', () => {
    expect(() => createBackendRegistry({ state, backends: [] })).toThrow()
  })

  it('lists descriptors with capabilities in registration order', () => {
    expect(make().list()).toEqual([
      { id: 'opencode', capabilities: caps({ workspaces: true, diff: true }) },
      { id: 'acp:kimi', capabilities: caps() },
    ])
  })

  it('primary defaults to the first registered backend', () => {
    expect(make().primaryId()).toBe('opencode')
  })

  it('honors an explicit valid primaryId, ignores an invalid one', () => {
    expect(make('acp:kimi').primaryId()).toBe('acp:kimi')
    expect(make('nope').primaryId()).toBe('opencode')
  })

  it('untagged sessions resolve to primary; tagged resolve to their backend', () => {
    const r = make()
    expect(r.idForSession('ses_unknown')).toBe('opencode')
    r.tag('k1', 'acp:kimi')
    expect(r.idForSession('k1')).toBe('acp:kimi')
    expect(r.forSession('k1').id).toBe('acp:kimi')
  })

  it('a stale tag (backend no longer registered) falls back to primary', () => {
    const r = make()
    state.setSessionBackend('s1', 'removed-backend')
    expect(r.idForSession('s1')).toBe('opencode')
  })

  it('activeId reflects state.activeBackend, falling back to primary', () => {
    const r = make()
    expect(r.activeId()).toBe('opencode')
    state.setActiveBackend('acp:kimi')
    expect(r.activeId()).toBe('acp:kimi')
    expect(r.active().id).toBe('acp:kimi')
    state.setActiveBackend('ghost')
    expect(r.activeId()).toBe('opencode')
  })

  it('get/has work by id', () => {
    const r = make()
    expect(r.has('acp:kimi')).toBe(true)
    expect(r.get('acp:kimi')!.id).toBe('acp:kimi')
    expect(r.has('nope')).toBe(false)
    expect(r.get('nope')).toBeUndefined()
  })
})
