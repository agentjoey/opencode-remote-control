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
  if (!host) return true
  const h = host.split(':')[0]
  return h === '127.0.0.1' || h === 'localhost' || h === '::1'
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
