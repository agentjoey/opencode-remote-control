import { buildPairCard, buildPairContext } from '../connectivity/pairing.js'

export async function main(): Promise<void> {
  const { token, url } = await buildPairContext()
  const card = await buildPairCard(url, token)
  console.log(card.qr)
  console.log(card.lines.join('\n'))
}

if (process.argv[1]?.endsWith('pair.js') || process.argv[1]?.endsWith('pair.ts')) {
  main().catch((err) => { console.error(err); process.exit(1) })
}
