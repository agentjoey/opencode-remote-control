import { loadOrCreateToken } from '../connectivity/auth/token.js'
import { resolvePublicUrl } from '../connectivity/exposure/providers.js'
import { buildPairCard } from '../connectivity/pairing.js'

export async function main(): Promise<void> {
  const port = Number(process.env.WEB_PORT ?? 17081)
  const token = loadOrCreateToken({ token: process.env.WEB_TOKEN })
  const url = await resolvePublicUrl({ publicUrl: process.env.WEB_PUBLIC_URL, port })
  const card = await buildPairCard(url, token)
  console.log(card.qr)
  console.log(card.lines.join('\n'))
}

if (process.argv[1]?.endsWith('pair.js') || process.argv[1]?.endsWith('pair.ts')) {
  main().catch((err) => { console.error(err); process.exit(1) })
}
