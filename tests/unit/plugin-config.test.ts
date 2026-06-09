import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadPluginConfig } from '../../src/plugin/config'

describe('loadPluginConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    for (const k of [
      'TELEGRAM_BOT_TOKEN', 'ALLOWED_USER_IDS', 'WEB_HOST', 'WEB_ENABLED',
      'WEB_CF_ACCESS_DEV_BYPASS', 'WEB_CF_ACCESS_TEAM', 'WEB_CF_ACCESS_AUD',
    ]) delete process.env[k]
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  function base(opts: Record<string, unknown> = {}) {
    return loadPluginConfig({ telegramBotToken: 't', allowedUserIds: '123', ...opts })
  }

  it('requires a telegram token', () => {
    // Set empty (present) so loadDotEnv's dotenv call won't repopulate from .env.
    process.env.TELEGRAM_BOT_TOKEN = ''
    expect(() => loadPluginConfig({ allowedUserIds: '123' })).toThrow(/TELEGRAM_BOT_TOKEN/)
  })

  it('requires at least one allowed user id', () => {
    process.env.ALLOWED_USER_IDS = ''
    expect(() => loadPluginConfig({ telegramBotToken: 't' })).toThrow(/ALLOWED_USER_IDS/)
  })

  it('parses comma-separated allowed user ids', () => {
    expect(base({ allowedUserIds: '1, 2 ,3' }).allowedUserIds).toEqual([1, 2, 3])
  })

  it('defaults CF Access dev bypass to OFF even on a loopback bind', () => {
    // A loopback bind is not a safe bypass signal behind a tunnel.
    expect(base({ webHost: '127.0.0.1' }).webCfAccessDevBypass).toBe(false)
  })

  it('honors explicit dev bypass opt-in', () => {
    expect(base({ webCfAccessDevBypass: 'true' }).webCfAccessDevBypass).toBe(true)
    process.env.WEB_CF_ACCESS_DEV_BYPASS = 'true'
    expect(base().webCfAccessDevBypass).toBe(true)
  })
})
