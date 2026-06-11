import { describe, it, expect, vi } from 'vitest'
import { startGlobalEvents } from '../../src/opencode/global-events'

function streamOf(items: any[], opts: { throwAfter?: boolean } = {}) {
  return (async function* () {
    for (const it of items) yield it
    if (opts.throwAfter) throw new Error('stream dropped')
  })()
}
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('startGlobalEvents', () => {
  it('forwards each event payload with its workspace directory', async () => {
    let calls = 0
    const client = {
      global: {
        event: vi.fn(async () => {
          calls++
          return {
            stream: calls === 1
              ? streamOf([
                  { directory: '/repo-a', payload: { type: 'session.idle' } },
                  { directory: undefined, payload: { type: 'server.connected' } },
                ])
              : streamOf([]), // later reconnects idle so the loop doesn't spin forever
          }
        }),
      },
    } as any
    const seen: Array<[string, string | undefined]> = []
    const h = startGlobalEvents({ client, onEvent: (e, d) => seen.push([e.type, d]), retryBaseMs: 5 })
    await tick(30)
    h.stop()
    expect(seen).toContainEqual(['session.idle', '/repo-a'])
    expect(seen).toContainEqual(['server.connected', undefined])
  })

  it('reconnects after the stream errors', async () => {
    let calls = 0
    const client = {
      global: {
        event: vi.fn(async () => {
          calls++
          return {
            stream: calls === 1
              ? streamOf([{ directory: '/r', payload: { type: 'x' } }], { throwAfter: true })
              : streamOf([]),
          }
        }),
      },
    } as any
    const h = startGlobalEvents({ client, onEvent: () => {}, retryBaseMs: 5 })
    await tick(40)
    h.stop()
    expect(calls).toBeGreaterThanOrEqual(2)
  })
})
