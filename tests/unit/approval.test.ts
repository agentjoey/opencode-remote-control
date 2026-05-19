import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventStream } from '../../src/opencode/event-stream.js'
import {
  setupApproval,
  type HandlersDeps,
  type PendingApproval,
} from '../../src/transport/telegram/handlers.js'

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

/** Flush pending microtasks to ensure async handlers complete */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('approval flow', () => {
  let eventStream: EventStream
  let deps: HandlersDeps
  let pending: Map<string, PendingApproval>
  let sentMessages: Array<{ text: string; opts: any }>
  let editedMessages: Array<{ messageId: number; text: string }>
  let approveHandler: (ctx: any) => Promise<void>

  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

    eventStream = new EventStream()
    sentMessages = []
    editedMessages = []
    approveHandler = async () => {}

    const mockBot = {
      command: vi.fn(),
      action: vi.fn().mockImplementation((_trigger: unknown, handler: any) => {
        approveHandler = handler
      }),
      telegram: {
        sendMessage: vi.fn().mockImplementation(
          (_chatId: number, text: string, opts: any) => {
            sentMessages.push({ text, opts })
            return Promise.resolve({ message_id: sentMessages.length })
          },
        ),
        editMessageText: vi.fn().mockImplementation(
          (_chatId: number, messageId: number, _inlineId: any, text: string) => {
            editedMessages.push({ messageId, text })
            return Promise.resolve({})
          },
        ),
      },
    } as any

    deps = {
      bot: mockBot,
      client: {} as any,
      baseUrl: 'http://localhost:4096',
      state: {
        getLastSessionId: vi.fn().mockReturnValue('ses_test'),
        setLastSessionId: vi.fn(),
        getNextAgent: vi.fn().mockReturnValue(undefined),
        setNextAgent: vi.fn(),
        getNextModel: vi.fn().mockReturnValue(undefined),
        setNextModel: vi.fn(),
        getTuiSelectedSession: vi.fn().mockReturnValue(undefined),
        setTuiSelectedSession: vi.fn(),
        getCurrentAgent: vi.fn().mockReturnValue(undefined),
        setCurrentAgent: vi.fn(),
        getActiveAbort: vi.fn().mockReturnValue(undefined),
        setActiveAbort: vi.fn(),
        getSessionCost: vi.fn().mockReturnValue(undefined),
        setSessionCost: vi.fn(),
        flush: vi.fn().mockResolvedValue(undefined),
      } as any,
      eventStream,
      chatId: 123456,
      isGenerating: () => false,
      abortGeneration: vi.fn(),
    }

    pending = new Map()
    setupApproval(deps, pending)

    // Start SSE loop so emitter is ready
    eventStream.start({
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: (async function* () {
            await new Promise(() => {})
          })(),
        }),
      },
    } as any)
  })

  function emit(event: unknown): void {
    const emitter = (eventStream as any).emitter
    emitter.listeners('*').forEach((fn: Function) => {
      try { fn(event) } catch (_) {}
    })
  }

  // Helper: emit event and wait for sendMessage + pending.set to complete
  async function emitAndWait(event: unknown): Promise<void> {
    emit(event)
    await vi.waitFor(() => expect(sentMessages).toHaveLength(1), { timeout: 1000 })
    await flush() // pending.set runs in microtask after await sendMessage
  }

  // ── v1 permission.updated ──

  it('sends approval card on permission.updated (v1) with title', async () => {
    await emitAndWait({
      type: 'permission.updated',
      properties: {
        id: 'perm-v1-001',
        title: 'Edit /src/foo.ts?',
        sessionID: 'ses_abc',
        type: 'edit',
      },
    })

    expect(sentMessages[0].text).toContain('Permission Required')
    expect(sentMessages[0].text).toContain('Edit /src/foo.ts?')
    const kb = sentMessages[0].opts.reply_markup.inline_keyboard[0]
    expect(kb[0].callback_data).toBe('approve:once:perm-v1-001')
    expect(kb[1].callback_data).toBe('approve:always:perm-v1-001')
    expect(kb[2].callback_data).toBe('approve:reject:perm-v1-001')
  })

  // ── v2 permission.asked ──

  it('sends approval card on permission.asked (v2) with permission field', async () => {
    await emitAndWait({
      type: 'permission.asked',
      properties: {
        id: 'perm-v2-001',
        permission: 'bash',
        sessionID: 'ses_def',
        patterns: ['*'],
      },
    })

    expect(sentMessages[0].text).toContain('Permission Required')
    expect(sentMessages[0].text).toContain('bash')
  })

  // ── v2 replied: requestID/reply fields ──

  it('edits card when replied uses requestID+reply (v2 fields)', async () => {
    await emitAndWait({
      type: 'permission.asked',
      properties: { id: 'perm-v2-002', permission: 'webfetch', sessionID: 'ses_ghi' },
    })

    emit({
      type: 'permission.replied',
      properties: { requestID: 'perm-v2-002', reply: 'once', sessionID: 'ses_ghi' },
    })

    await vi.waitFor(() => expect(editedMessages).toHaveLength(1), { timeout: 1000 })

    expect(editedMessages[0].text).toContain('Allowed (once)')
    expect(editedMessages[0].text).toContain('(from TUI)')
  })

  // ── v1 replied: permissionID/response fields ──

  it('edits card when replied uses permissionID+response (v1 fields)', async () => {
    await emitAndWait({
      type: 'permission.updated',
      properties: { id: 'perm-v1-003', title: 'edit', sessionID: 'ses_jkl' },
    })

    emit({
      type: 'permission.replied',
      properties: { permissionID: 'perm-v1-003', response: 'reject' },
    })

    await vi.waitFor(() => expect(editedMessages).toHaveLength(1), { timeout: 1000 })

    expect(editedMessages[0].text).toContain('Rejected')
    expect(editedMessages[0].text).toContain('(from TUI)')
  })

  // ── Button callback: approve:once ──

  it('calls postSessionIdPermissionsPermissionId on approve button click', async () => {
    const postSessionIdPermissionsPermissionId = vi.fn().mockResolvedValue(undefined)
    deps.client = { postSessionIdPermissionsPermissionId } as any

    await emitAndWait({
      type: 'permission.asked',
      properties: { id: 'perm-btn-001', permission: 'edit', sessionID: 'ses_btn' },
    })

    const ctx = {
      match: ['approve:once:perm-btn-001', 'once', 'perm-btn-001'],
      answerCbQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
    }

    await approveHandler(ctx)

    expect(postSessionIdPermissionsPermissionId).toHaveBeenCalledWith({
      path: { id: 'ses_btn', permissionID: 'perm-btn-001' },
      body: { response: 'once' },
    })
    expect(ctx.editMessageText).toHaveBeenCalledWith('✅ Allowed (once)\n\nedit', { parse_mode: 'HTML' })
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('✅ Allowed (once)')
  })

  // ── Already handled ──

  it('shows "already handled" for unknown permId', async () => {
    const ctx = {
      match: ['approve:once:perm-nope', 'once', 'perm-nope'],
      answerCbQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
    }

    await approveHandler(ctx)

    expect(ctx.answerCbQuery).toHaveBeenCalledWith('This request has already been handled.')
    expect(ctx.editMessageText).not.toHaveBeenCalled()
  })

  // ── Ignores non-permission events ──

  it('does not send messages for non-permission events', async () => {
    emit({ type: 'message.part.updated', properties: { part: { text: 'hello' } } })
    await flush()
    expect(sentMessages).toHaveLength(0)
  })
})
