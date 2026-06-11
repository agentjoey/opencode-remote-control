import { describe, it, expect, afterEach } from 'vitest'
import { tryBecomePrimary } from '../../src/core/primary-election'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'oprc-elect-'))
const lock = join(tmp, 'primary.lock')
afterEach(() => { try { rmSync(lock) } catch { /* ignore */ } })

describe('tryBecomePrimary', () => {
  it('first caller becomes PRIMARY', () => {
    const a = tryBecomePrimary(lock)
    expect(a.isPrimary).toBe(true)
    a.release()
  })

  it('second caller is PASSIVE while a live pid holds the lock', () => {
    const a = tryBecomePrimary(lock)
    const b = tryBecomePrimary(lock) // our own pid is alive
    expect(a.isPrimary).toBe(true)
    expect(b.isPrimary).toBe(false)
    a.release()
  })

  it('reclaims a stale lock whose owner pid is dead', () => {
    writeFileSync(lock, JSON.stringify({ pid: 2147483646, startedAt: 1 })) // not a live pid
    const a = tryBecomePrimary(lock)
    expect(a.isPrimary).toBe(true)
    a.release()
  })

  it('reclaims a corrupt lock file (non-JSON content)', () => {
    writeFileSync(lock, 'not-json-garbage')
    const a = tryBecomePrimary(lock)
    expect(a.isPrimary).toBe(true)
    a.release()
  })

  it('release frees the lock so a later caller can win', () => {
    const a = tryBecomePrimary(lock)
    a.release()
    const b = tryBecomePrimary(lock)
    expect(b.isPrimary).toBe(true)
    b.release()
  })

  it('release is idempotent', () => {
    const a = tryBecomePrimary(lock)
    a.release()
    a.release() // must not throw or corrupt state
    const b = tryBecomePrimary(lock)
    expect(b.isPrimary).toBe(true)
    b.release()
  })
})
