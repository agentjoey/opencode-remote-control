import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileBackedState } from '../../src/core/state'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'state-test-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('SessionState', () => {
  it('returns undefined when no file exists', () => {
    const state = createFileBackedState(join(dir, 'state.json'))
    expect(state.getLastSessionId()).toBeUndefined()
    expect(state.getNextAgent()).toBeUndefined()
    expect(state.getNextModel()).toBeUndefined()
  })

  it('round-trips lastSessionId', async () => {
    const path = join(dir, 'state.json')
    const a = createFileBackedState(path)
    a.setLastSessionId('ses_1')
    await a.flush()
    const b = createFileBackedState(path)
    expect(b.getLastSessionId()).toBe('ses_1')
  })

  it('round-trips nextAgent + nextModel', async () => {
    const path = join(dir, 'state.json')
    const a = createFileBackedState(path)
    a.setNextAgent('build')
    a.setNextModel({ providerID: 'kimi-for-coding', modelID: 'k2p6' })
    await a.flush()
    const b = createFileBackedState(path)
    expect(b.getNextAgent()).toBe('build')
    expect(b.getNextModel()).toEqual({ providerID: 'kimi-for-coding', modelID: 'k2p6' })
  })

  it('recovers from malformed JSON by treating as empty', () => {
    const path = join(dir, 'state.json')
    writeFileSync(path, 'not json {{{')
    const state = createFileBackedState(path)
    expect(state.getLastSessionId()).toBeUndefined()
  })

  it('clears nextAgent when set to undefined', async () => {
    const path = join(dir, 'state.json')
    const a = createFileBackedState(path)
    a.setNextAgent('build')
    a.setNextAgent(undefined)
    await a.flush()
    const b = createFileBackedState(path)
    expect(b.getNextAgent()).toBeUndefined()
  })

  it('round-trips tuiSelectedSession + currentAgent', async () => {
    const path = join(dir, 'state.json')
    const a = createFileBackedState(path)
    a.setTuiSelectedSession('ses_xyz')
    a.setCurrentAgent('build')
    await a.flush()
    const b = createFileBackedState(path)
    expect(b.getTuiSelectedSession()).toBe('ses_xyz')
    expect(b.getCurrentAgent()).toBe('build')
  })

  it('persists activeWorkspace', () => {
    const s = createFileBackedState(join(dir, 'state.json'))
    expect(s.getActiveWorkspace()).toBeUndefined()
    s.setActiveWorkspace('/Users/x/repo')
    expect(s.getActiveWorkspace()).toBe('/Users/x/repo')
    s.setActiveWorkspace(undefined)
    expect(s.getActiveWorkspace()).toBeUndefined()
  })

  it('tracks active generation via the abort registry', () => {
    const s = createFileBackedState(join(dir, 'state.json'))
    expect(s.hasActiveGeneration()).toBe(false)
    const ac = new AbortController()
    s.setActiveAbort('ses_1', ac)
    expect(s.hasActiveGeneration()).toBe(true)
    expect(s.getActiveAbort('ses_1')).toBe(ac)
    s.setActiveAbort('ses_1', undefined)
    expect(s.hasActiveGeneration()).toBe(false)
  })
})
