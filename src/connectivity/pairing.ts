import QRCode from 'qrcode'
import { loadOrCreateToken } from './auth/token.js'
import { resolvePublicUrl } from './exposure/providers.js'

/** Build the pairing URL with the token in the fragment (never the query, so it
 * isn't logged by proxies; the PWA reads it client-side then stores it). */
export function buildPairUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/#token=${encodeURIComponent(token)}`
}

export interface PairCard {
  url: string
  /** Terminal-renderable QR string. */
  qr: string
  /** Human-readable lines for terminals/chat. */
  lines: string[]
}

export async function buildPairCard(base: string, token: string): Promise<PairCard> {
  const url = buildPairUrl(base, token)
  const qr = await QRCode.toString(url, { type: 'terminal', small: true })
  const lines = [
    'Scan to pair this device with opencode-remote-control:',
    '',
    url,
    '',
    'The token is stored on the device after the first open.',
  ]
  return { url, qr, lines }
}

export interface PairContext {
  token: string
  url: string
}

/** Resolve the current pairing token + best public URL from env (shared by the
 * CLI `oprc pair` and the Telegram `/pair` command). */
export async function buildPairContext(): Promise<PairContext> {
  const port = Number(process.env.WEB_PORT ?? 17081)
  const token = loadOrCreateToken({ token: process.env.WEB_TOKEN })
  const url = await resolvePublicUrl({ publicUrl: process.env.WEB_PUBLIC_URL, port })
  return { token, url }
}
