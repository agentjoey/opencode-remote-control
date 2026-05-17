import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface CfAccessOpts {
  team: string
  aud: string
  devBypass?: boolean
  devEmail?: string
  host?: string
}

function isLoopback(host?: string): boolean {
  if (!host) return false
  const h = host.split(':')[0]
  return h === '127.0.0.1' || h === 'localhost' || h === '::1'
}

function extractJwt(headers: Record<string, string | string[] | undefined>, query?: string): string | undefined {
  const header = headers['cf-access-jwt-assertion']
  if (typeof header === 'string') return header
  if (query) {
    const q = new URLSearchParams(query)
    const j = q.get('cf_access_jwt')
    if (j) return j
  }
  const cookie = headers['cookie']
  if (typeof cookie === 'string') {
    const m = cookie.match(/CF_Authorization=([^;]+)/)
    if (m) return m[1]
  }
}

export async function verifyUpgradeJwt(
  req: { headers: Record<string, string | string[] | undefined>; url?: string },
  opts: CfAccessOpts,
): Promise<{ email: string; sub: string } | null> {
  if (opts.devBypass && isLoopback(opts.host)) {
    return { email: opts.devEmail ?? 'dev@localhost', sub: 'dev' }
  }
  const query = req.url ? req.url.split('?')[1] : undefined
  const jwt = extractJwt(req.headers, query)
  if (!jwt) return null
  try {
    const jwks = createRemoteJWKSet(new URL(`https://${opts.team}.cloudflareaccess.com/cdn-cgi/access/certs`))
    const { payload } = await jwtVerify(jwt, jwks, {
      issuer: `https://${opts.team}.cloudflareaccess.com`,
      audience: opts.aud,
    })
    return { email: payload.email as string, sub: payload.sub as string }
  } catch {
    return null
  }
}

export function cfAccessMiddleware(opts: CfAccessOpts): MiddlewareHandler {
  const jwksUri = `https://${opts.team}.cloudflareaccess.com/cdn-cgi/access/certs`
  const issuer = `https://${opts.team}.cloudflareaccess.com`
  const jwks = createRemoteJWKSet(new URL(jwksUri))

  return async (c, next) => {
    // Dev bypass
    if (opts.devBypass && isLoopback(opts.host ?? c.req.header('host') ?? undefined)) {
      c.set('user', { email: opts.devEmail ?? 'dev@localhost', sub: 'dev' })
      return next()
    }

    const jwt =
      c.req.header('cf-access-jwt-assertion') ||
      c.req.query('cf_access_jwt') ||
      c.req.header('cookie')?.match(/CF_Authorization=([^;]+)/)?.[1]

    if (!jwt) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    try {
      const { payload } = await jwtVerify(jwt, jwks, { issuer, audience: opts.aud })
      c.set('user', { email: payload.email as string, sub: payload.sub as string })
      return next()
    } catch {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }
}
