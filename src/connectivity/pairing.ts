import QRCode from 'qrcode'

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
