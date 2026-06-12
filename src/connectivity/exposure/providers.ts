import { networkInterfaces } from 'node:os'
import type { ExposureInfo } from './index.js'
import { detectCloudflaredHostname } from './cloudflared.js'

export interface ResolveOptions {
  /** Configured public URL (e.g. the Cloudflare Tunnel hostname). */
  publicUrl?: string
  /** Web port (for LAN/loopback URLs). */
  port: number
  /** Override for tests; defaults to the first non-internal IPv4 address. */
  lanIpResolver?: () => string | undefined
  /** Override for tests; defaults to scanning ~/.cloudflared for the web port. */
  cloudflaredResolver?: () => string | undefined
}

function firstLanIpv4(): string | undefined {
  const ifaces = networkInterfaces()
  const skip = /^(utun|tun|tap|docker|br-|bridge|veth|vmnet|llw|awdl)/i
  const ipv4 = (name: string): string | undefined => {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address
    }
    return undefined
  }
  const names = Object.keys(ifaces)
  // Prefer physical LAN interfaces (en*/eth*), then any non-virtual interface.
  const preferred = names.filter((n) => /^(en|eth)/i.test(n))
  for (const n of [...preferred, ...names]) {
    if (!preferred.includes(n) && skip.test(n)) continue
    const ip = ipv4(n)
    if (ip) return ip
  }
  return undefined
}

/**
 * Resolve the best public base URL:
 * explicit publicUrl > auto-detected cloudflared hostname > LAN IP > loopback.
 */
export async function resolvePublicUrl(opts: ResolveOptions): Promise<string> {
  return (await resolveExposure(opts)).url
}

export async function resolveExposure(opts: ResolveOptions): Promise<ExposureInfo> {
  if (opts.publicUrl && opts.publicUrl.trim()) {
    let u = opts.publicUrl.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`
    return { url: u, provider: 'cf-tunnel' }
  }
  // No explicit URL: if a local cloudflared tunnel already maps a hostname to
  // this port, prefer that reachable HTTPS URL over an unreachable LAN IP.
  const cfHost = (opts.cloudflaredResolver ?? (() => detectCloudflaredHostname(opts.port)))()
  if (cfHost) return { url: `https://${cfHost.replace(/\/+$/, '')}`, provider: 'cf-tunnel' }
  const lan = (opts.lanIpResolver ?? firstLanIpv4)()
  if (lan) return { url: `http://${lan}:${opts.port}`, provider: 'lan' }
  return { url: `http://127.0.0.1:${opts.port}`, provider: 'loopback' }
}
