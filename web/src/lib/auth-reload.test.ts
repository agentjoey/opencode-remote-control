// src/lib/auth-reload.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleAuthFailure, AUTH_RELOAD_FLAG } from './auth-reload.js'

beforeEach(() => { sessionStorage.clear() })

function fakeLocation() { return { reload: vi.fn(), href: 'https://app/' } as any }

describe('handleAuthFailure', () => {
  it('reloads once when no prior reload flag is set', () => {
    const loc = fakeLocation()
    handleAuthFailure(loc)
    expect(loc.reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(AUTH_RELOAD_FLAG)).toBe('1')
  })

  it('does NOT reload again if the flag is already set (loop guard)', () => {
    sessionStorage.setItem(AUTH_RELOAD_FLAG, '1')
    const loc = fakeLocation()
    handleAuthFailure(loc)
    expect(loc.reload).not.toHaveBeenCalled()
  })

  it('clearAuthReloadFlag lets a future failure reload again', async () => {
    const { clearAuthReloadFlag } = await import('./auth-reload.js')
    sessionStorage.setItem(AUTH_RELOAD_FLAG, '1')
    clearAuthReloadFlag()
    const loc = fakeLocation()
    handleAuthFailure(loc)
    expect(loc.reload).toHaveBeenCalledTimes(1)
  })
})
