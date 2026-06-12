import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Best-effort auto-detection of a Cloudflare Tunnel hostname for the web port,
// so `oprc pair` / the exposure provider can emit a reachable HTTPS URL even when
// WEB_PUBLIC_URL isn't set. We parse the small, regular cloudflared ingress YAML
// directly (no YAML dependency): each ingress item has a `hostname` and a
// `service`; we return the hostname whose service is http(s)://localhost:<port>.

interface IngressItem { hostname?: string; service?: string }

function applyKv(item: IngressItem, text: string): void {
  const m = text.match(/^(hostname|service)\s*:\s*(.+?)\s*$/)
  if (!m) return
  const val = m[2].replace(/^["']|["']$/g, '')
  if (m[1] === 'hostname') item.hostname = val
  else item.service = val
}

function serviceMatchesPort(service: string | undefined, port: number): boolean {
  if (!service) return false
  // Anchor on a non-digit (or end) after the port so 17081 ≠ 170810.
  return new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${port}(?:[/?#]|$)`).test(service.trim())
}

/** Return the ingress hostname mapped to http(s)://localhost:<port>, if any. */
export function parseCloudflaredIngress(yamlText: string, port: number): string | undefined {
  const lines = yamlText.split(/\r?\n/)
  let i = lines.findIndex((l) => /^\s*ingress\s*:\s*$/.test(l))
  if (i < 0) return undefined
  const ingressIndent = lines[i].match(/^(\s*)/)![1].length

  const items: IngressItem[] = []
  let cur: IngressItem | null = null
  for (i = i + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const indent = line.match(/^(\s*)/)![1].length
    if (indent <= ingressIndent) break // dedented out of the ingress block
    const dash = line.match(/^\s*-\s+(.*)$/)
    if (dash) {
      cur = {}
      items.push(cur)
      applyKv(cur, dash[1])
    } else if (cur) {
      applyKv(cur, line.trim())
    }
  }

  return items.find((it) => it.hostname && serviceMatchesPort(it.service, port))?.hostname
}

export interface DetectOptions {
  /** cloudflared config dir; defaults to ~/.cloudflared. */
  configDir?: string
  /** Injectable for tests. */
  readDir?: (dir: string) => string[]
  /** Injectable for tests. */
  readFile?: (path: string) => string
}

/** Scan ~/.cloudflared/*.{yml,yaml} for a tunnel hostname mapped to the web port. */
export function detectCloudflaredHostname(port: number, opts: DetectOptions = {}): string | undefined {
  const dir = opts.configDir ?? join(homedir(), '.cloudflared')
  const readDir = opts.readDir ?? ((d) => { try { return readdirSync(d) } catch { return [] } })
  const readFile = opts.readFile ?? ((p) => { try { return readFileSync(p, 'utf8') } catch { return '' } })

  let files: string[]
  try {
    files = readDir(dir).filter((f) => /\.ya?ml$/i.test(f))
  } catch {
    return undefined
  }
  for (const f of files) {
    const host = parseCloudflaredIngress(readFile(join(dir, f)), port)
    if (host) return host
  }
  return undefined
}
