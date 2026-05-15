import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Telegraf } from 'telegraf'
import { registerCommands } from '../../src/bot/handlers/commands'

function makeBot() {
  const bot = new Telegraf('fake:token', { handlerTimeout: 600_000 })
  ;(bot.telegram as any).callApi = vi.fn()
  vi.spyOn(bot.telegram, 'setMyCommands').mockResolvedValue(true)
  return bot
}

describe('/files command registration', () => {
  it('registers without error', () => {
    const bot = makeBot()
    const client = {
      session: {
        list: async () => ({ data: [] }),
        messages: async () => ({ data: [] }),
        message: async () => ({ data: {} }),
      },
    } as any

    expect(() => {
      registerCommands({
        bot,
        client,
        baseUrl: 'http://localhost:4096',
        getLastSessionId: () => 'ses_test',
        setLastSessionId: () => {},
      })
    }).not.toThrow()
  })
})
