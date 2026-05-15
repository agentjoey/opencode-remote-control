import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../../src/config'

describe('loadConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.ALLOWED_USER_ID
    delete process.env.OPENCODE_BASE_URL
    delete process.env.EDIT_THROTTLE_MS
    delete process.env.CHAT_TIMEOUT_MS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('loads required fields and applies defaults', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.ALLOWED_USER_ID = '12345'

    const cfg = loadConfig()
    expect(cfg.telegramBotToken).toBe('tok')
    expect(cfg.allowedUserId).toBe(12345)
    expect(cfg.opencodeBaseUrl).toBe('http://localhost:4096')
    expect(cfg.editThrottleMs).toBe(1000)
    expect(cfg.chatTimeoutMs).toBe(300000)
  })

  it('throws when TELEGRAM_BOT_TOKEN missing', () => {
    process.env.ALLOWED_USER_ID = '12345'
    expect(() => loadConfig()).toThrow(/TELEGRAM_BOT_TOKEN/)
  })

  it('throws when ALLOWED_USER_ID is non-numeric', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.ALLOWED_USER_ID = 'abc'
    expect(() => loadConfig()).toThrow()
  })

  it('respects explicit env overrides', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.ALLOWED_USER_ID = '7'
    process.env.OPENCODE_BASE_URL = 'http://example:9000'
    process.env.EDIT_THROTTLE_MS = '500'
    process.env.CHAT_TIMEOUT_MS = '30000'

    const cfg = loadConfig()
    expect(cfg.opencodeBaseUrl).toBe('http://example:9000')
    expect(cfg.editThrottleMs).toBe(500)
    expect(cfg.chatTimeoutMs).toBe(30000)
  })
})
