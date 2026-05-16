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
    delete process.env.STREAM_OUTPUT
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('loads required fields and applies defaults', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.ALLOWED_USER_ID = '12345'

    const cfg = loadConfig()
    expect(cfg.telegramBotToken).toBe('tok')
    expect(cfg.allowedUserIds).toEqual([12345])
    expect(cfg.opencodeBaseUrl).toBe('http://localhost:4096')
    expect(cfg.editThrottleMs).toBe(1000)
    expect(cfg.chatTimeoutMs).toBe(600000)
    expect(cfg.streamOutput).toBe(true)
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
    expect(cfg.streamOutput).toBe(true)
  })

  it('parses STREAM_OUTPUT=false', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.ALLOWED_USER_ID = '1'
    process.env.STREAM_OUTPUT = 'false'

    const cfg = loadConfig()
    expect(cfg.streamOutput).toBe(false)
  })

  it('parses ALLOWED_USER_IDS comma-separated', () => {
    process.env.ALLOWED_USER_IDS = '1,2,3'
    process.env.TELEGRAM_BOT_TOKEN = 't'
    delete process.env.ALLOWED_USER_ID
    const c = loadConfig()
    expect(c.allowedUserIds).toEqual([1, 2, 3])
  })

  it('accepts legacy ALLOWED_USER_ID', () => {
    delete process.env.ALLOWED_USER_IDS
    process.env.ALLOWED_USER_ID = '42'
    process.env.TELEGRAM_BOT_TOKEN = 't'
    const c = loadConfig()
    expect(c.allowedUserIds).toEqual([42])
  })

  it('throws when neither is set', () => {
    delete process.env.ALLOWED_USER_IDS
    delete process.env.ALLOWED_USER_ID
    process.env.TELEGRAM_BOT_TOKEN = 't'
    expect(() => loadConfig()).toThrow()
  })
})
