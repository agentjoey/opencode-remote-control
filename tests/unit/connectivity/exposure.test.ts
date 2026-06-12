import { describe, it, expect } from 'vitest'
import { resolvePublicUrl, resolveExposure } from '../../../src/connectivity/exposure/providers.js'

describe('resolvePublicUrl', () => {
  it('prefers an explicit public URL (cf-tunnel), stripping trailing slash', async () => {
    const url = await resolvePublicUrl({ publicUrl: 'https://ocrc.example.com/', port: 17081 })
    expect(url).toBe('https://ocrc.example.com')
  })
  it('prefers an auto-detected cloudflared hostname over a LAN IP', async () => {
    const url = await resolvePublicUrl({
      port: 17081,
      cloudflaredResolver: () => 'ocrc.example.com',
      lanIpResolver: () => '192.168.1.50',
    })
    expect(url).toBe('https://ocrc.example.com')
  })
  it('falls back to a LAN URL when no public URL or tunnel is found', async () => {
    const url = await resolvePublicUrl({
      port: 17081,
      cloudflaredResolver: () => undefined,
      lanIpResolver: () => '192.168.1.50',
    })
    expect(url).toBe('http://192.168.1.50:17081')
  })
  it('falls back to loopback when no LAN IP is found', async () => {
    const url = await resolvePublicUrl({
      port: 17081,
      cloudflaredResolver: () => undefined,
      lanIpResolver: () => undefined,
    })
    expect(url).toBe('http://127.0.0.1:17081')
  })
})

describe('resolveExposure', () => {
  it('reports the provider and adds https:// to a schemeless public url', async () => {
    expect(await resolveExposure({ publicUrl: 'ocrc.example.com', port: 17081 }))
      .toEqual({ url: 'https://ocrc.example.com', provider: 'cf-tunnel' })
  })
  it('reports cf-tunnel provider for an auto-detected cloudflared hostname', async () => {
    expect(await resolveExposure({ port: 17081, cloudflaredResolver: () => 'auto.example.com' }))
      .toEqual({ url: 'https://auto.example.com', provider: 'cf-tunnel' })
  })
  it('reports lan provider when using a LAN ip', async () => {
    expect(await resolveExposure({ port: 17081, cloudflaredResolver: () => undefined, lanIpResolver: () => '192.168.1.9' }))
      .toEqual({ url: 'http://192.168.1.9:17081', provider: 'lan' })
  })
  it('reports loopback provider as last resort', async () => {
    expect(await resolveExposure({ port: 17081, cloudflaredResolver: () => undefined, lanIpResolver: () => undefined }))
      .toEqual({ url: 'http://127.0.0.1:17081', provider: 'loopback' })
  })
})
