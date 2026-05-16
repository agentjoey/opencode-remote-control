import { describe, it, expect, vi } from 'vitest'
import { createWebTransport } from '../../../src/transport/web/index'

describe('createWebTransport', () => {
  it('exposes name + capabilities.streaming=true', () => {
    const t = createWebTransport({
      host: '127.0.0.1', port: 7081,
      client: {} as any, eventStream: {} as any,
      cfAccess: { team: '', aud: '', devBypass: true, devEmail: 'd@l', host: '127.0.0.1' },
      staticRoot: '/tmp/nonexistent',
      cacheSize: 100,
    })
    expect(t.name).toBe('web')
    expect(t.capabilities.streaming).toBe(true)
  })

  it('throws on start if static root missing', async () => {
    const t = createWebTransport({
      host: '127.0.0.1', port: 0,
      client: {} as any, eventStream: {} as any,
      cfAccess: { team: '', aud: '', devBypass: true, devEmail: 'd@l', host: '127.0.0.1' },
      staticRoot: '/tmp/definitely-not-here-xyz',
      cacheSize: 100,
    })
    await expect(t.start({ cardBus: { subscribeAll: () => () => {} } as any, state: {} as any })).rejects.toThrow()
  })
})
