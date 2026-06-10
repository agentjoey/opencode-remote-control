import { SignJWT, jwtVerify } from 'jose'
import { randomBytes, randomUUID } from 'node:crypto'

/**
 * Short-lived, single-use WebSocket tickets (B5 option A1).
 *
 * A browser WebSocket can't carry CF-Access-Client-Id/Secret headers, so a
 * service-token client (the extension) can't auth the `/ws` upgrade at the CF
 * edge. Instead `/ws` is put on a CF Access *bypass*, and this app gates it: the
 * client does an authenticated REST call to GET /api/ws-ticket, receives a
 * 60s single-use ticket, and connects `/ws?ticket=…`. The ticket is an HS256
 * JWT signed with a per-process random secret — it need not survive restarts.
 */

const TTL_SECONDS = 60
const secret = randomBytes(32)
// Consumed ticket ids (jti) so a ticket can't be replayed within its TTL.
const consumed = new Set<string>()

export interface TicketUser {
  email?: string
  sub: string
}

export async function mintWsTicket(user: TicketUser): Promise<string> {
  return new SignJWT({ email: user.email, sub: user.sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret)
}

export async function verifyWsTicket(token: string): Promise<TicketUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    const jti = typeof payload.jti === 'string' ? payload.jti : undefined
    if (!jti || consumed.has(jti)) return null
    consumed.add(jti)
    // Drop the jti shortly after it can no longer be valid, to bound memory.
    const t = setTimeout(() => consumed.delete(jti), (TTL_SECONDS + 10) * 1000)
    if (typeof (t as any).unref === 'function') (t as any).unref()
    return { email: typeof payload.email === 'string' ? payload.email : undefined, sub: String(payload.sub) }
  } catch {
    return null
  }
}
