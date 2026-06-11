import { networkInterfaces } from 'node:os'
import type { ExposureInfo } from './index.js'

export interface ResolveOptions {
  /** Configured public URL (e.g. the Cloudflare Tunnel hostname). */
  publicUrl?: string
  /** Web port (for LAN/loopback URLs). */
  port: number
  /** Override for tests; defaults to the first non-internal IPv4 address. */
  lanIpResolver?: () => string | undefined
}

function firstLanIpv4(): string | undefined {
  const ifaces = networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address
    }
  }
  return undefined
}

/** Resolve the best public base URL: explicit publicUrl (cf-tunnel) > LAN IP > loopback. */
export async function resolvePublicUrl(opts: ResolveOptions): Promise<string> {
  return (await resolveExposure(opts)).url
}

export async function resolveExposure(opts: ResolveOptions): Promise<ExposureInfo> {
  if (opts.publicUrl && opts.publicUrl.trim()) {
    return { url: opts.publicUrl.trim().replace(/\/+$/, ''), provider: 'cf-tunnel' }
  }
  const lan = (opts.lanIpResolver ?? firstLanIpv4)()
  if (lan) return { url: `http://${lan}:${opts.port}`, provider: 'lan' }
  return { url: `http://127.0.0.1:${opts.port}`, provider: 'loopback' }
}
