import type { AuthStrategy } from './index.js'
import { createRemoteJWKSet } from 'jose'
import { cfAccessMiddleware, verifyUpgradeJwt, type CfAccessOpts } from '../../transport/web/middleware/cf-access.js'

/** Wrap the existing Cloudflare Access middleware/verifier as an AuthStrategy. */
export function createCfAccessAuth(opts: CfAccessOpts): AuthStrategy {
  const jwks = opts.team
    ? createRemoteJWKSet(new URL(`https://${opts.team}.cloudflareaccess.com/cdn-cgi/access/certs`))
    : undefined
  return {
    httpMiddleware: () => cfAccessMiddleware(opts),
    verifyUpgrade: (req) => verifyUpgradeJwt(req, opts, jwks),
  }
}
