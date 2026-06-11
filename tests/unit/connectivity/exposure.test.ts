import { describe, it, expect } from 'vitest'
import { resolvePublicUrl } from '../../../src/connectivity/exposure/providers.js'

describe('resolvePublicUrl', () => {
  it('prefers an explicit public URL (cf-tunnel), stripping trailing slash', async () => {
    const url = await resolvePublicUrl({ publicUrl: 'https://ocrc.example.com/', port: 17081 })
    expect(url).toBe('https://ocrc.example.com')
  })
  it('falls back to a LAN URL when no public URL is set', async () => {
    const url = await resolvePublicUrl({ port: 17081, lanIpResolver: () => '192.168.1.50' })
    expect(url).toBe('http://192.168.1.50:17081')
  })
  it('falls back to loopback when no LAN IP is found', async () => {
    const url = await resolvePublicUrl({ port: 17081, lanIpResolver: () => undefined })
    expect(url).toBe('http://127.0.0.1:17081')
  })
})
