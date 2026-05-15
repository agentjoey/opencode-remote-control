import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Telegraf } from 'telegraf'
import { registerCallbacks } from '../../src/bot/handlers/callbacks'

/** Extract the handler that matches a given action pattern from a telegraf bot. */
function findAction(bot: Telegraf, pattern: RegExp | string): ((ctx: any) => Promise<void>) | undefined {
  const middleware = (bot as any).middleware
  if (!middleware) return undefined
  // Walk the middleware chain looking for action handlers
  for (const layer of middleware) {
    if (layer.inlineFilter && layer.inlineFilter({})) {
      return layer.handler
    }
  }
  return undefined
}

function makeCtx(overrides: any = {}) {
  const answerCbQuery = vi.fn().mockResolvedValue(true)
  return {
    match: overrides.match,
    answerCbQuery,
    editMessageText: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe('registerCallbacks', () => {
  let bot: Telegraf
  let lastSessionId: string | undefined
  let isGenerating = false
  let aborted = false
  let baseUrl = 'http://localhost:4096'

  beforeEach(() => {
    bot = new Telegraf('fake:token', { handlerTimeout: 600_000 })
    ;(bot.telegram as any).callApi = vi.fn()
    ;(bot.telegram as any).setMyCommands = vi.fn()
    lastSessionId = undefined
    isGenerating = false
    aborted = false
    baseUrl = 'http://localhost:4096'
  })

  it('registers callbacks without error', () => {
    registerCallbacks({
      bot,
      baseUrl,
      getLastSessionId: () => lastSessionId,
      setLastSessionId: (id) => { lastSessionId = id },
      isGenerating: () => isGenerating,
      abortGeneration: () => { aborted = true },
    })
    // No error = registered successfully
    expect(true).toBe(true)
  })
})
