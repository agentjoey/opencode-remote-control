import type { AuthStrategy } from './index.js'
import { cfAccessMiddleware, verifyUpgradeJwt, type CfAccessOpts } from '../../transport/web/middleware/cf-access.js'

/** Wrap the existing Cloudflare Access middleware/verifier as an AuthStrategy. */
export function createCfAccessAuth(opts: CfAccessOpts): AuthStrategy {
  return {
    httpMiddleware: () => cfAccessMiddleware(opts),
    verifyUpgrade: (req) => verifyUpgradeJwt(req, opts),
  }
}
