import { describe, it, expect, vi } from 'vitest'
import { registerHandlers, type PendingApproval } from '../../../src/transport/telegram/handlers'

/** A Telegraf stand-in that records action(regex/string, handler) registrations. */
function captureBot() {
  const actions: Array<{ trigger: any; handler: (ctx: any) => any }> = []
  return {
    actions,
    command: vi.fn(),
    action: vi.fn((trigger: any, handler: (ctx: any) => any) => { actions.push({ trigger, handler }) }),
    telegram: { setMyCommands: vi.fn().mockResolvedValue(undefined) },
  }
}

function findApprove(bot: ReturnType<typeof captureBot>) {
  const entry = bot.actions.find((a) => a.trigger instanceof RegExp && a.trigger.test('approve:once:perm_1'))
  if (!entry) throw new Error('approve action not registered')
  return entry
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const pendingApprovals = new Map<string, PendingApproval>()
  const bot = captureBot()
  const backend = { resolvePermission: vi.fn().mockResolvedValue(undefined) }
  const deps: any = {
    bot,
    backend,
    state: {} as any,
    chatId: 1,
    isGenerating: () => false,
    abortGeneration: vi.fn(),
    baseUrl: '',
    pendingApprovals,
    ...overrides,
  }
  registerHandlers(deps)
  return { bot, backend, pendingApprovals, deps }
}

describe('approve: button callback', () => {
  it('replies the decision to opencode and clears the pending approval', async () => {
    const { bot, backend, pendingApprovals } = makeDeps()
    pendingApprovals.set('perm_1', { sessionId: 'ses_a', permissionId: 'perm_1', messageId: 42, title: 'Edit foo.ts' })

    const { trigger, handler } = findApprove(bot)
    const ctx = {
      match: 'approve:always:perm_1'.match(trigger),
      answerCbQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
    }
    await handler(ctx)

    expect(backend.resolvePermission).toHaveBeenCalledWith('ses_a', 'perm_1', 'always')
    expect(pendingApprovals.has('perm_1')).toBe(false)
    expect(ctx.editMessageText).toHaveBeenCalled()
    expect(ctx.answerCbQuery).toHaveBeenCalled()
  })

  it('answers "already handled" when the approval is unknown', async () => {
    const { bot, backend } = makeDeps()
    const { trigger, handler } = findApprove(bot)
    const ctx = {
      match: 'approve:reject:gone'.match(trigger),
      answerCbQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
    }
    await handler(ctx)

    expect(backend.resolvePermission).not.toHaveBeenCalled()
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringMatching(/already been handled/i))
  })
})
