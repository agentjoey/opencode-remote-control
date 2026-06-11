import type { AuthStrategy } from './index.js'
import { createTokenAuth } from './token.js'
import { createCfAccessAuth } from './cf-access.js'
import type { CfAccessOpts } from '../../transport/web/middleware/cf-access.js'

export interface AuthSelection {
  mode: 'token' | 'cf-access'
  token?: string
  tokenPath?: string
  devEmail?: string
  devBypass?: boolean
  host?: string
  cfAccess?: CfAccessOpts
}

export function selectAuthStrategy(sel: AuthSelection): AuthStrategy {
  if (sel.mode === 'cf-access') {
    const cf = sel.cfAccess
    if (!cf?.team || !cf?.aud) {
      throw new Error('WEB_AUTH=cf-access requires WEB_CF_ACCESS_TEAM and WEB_CF_ACCESS_AUD to be set')
    }
    return createCfAccessAuth(cf)
  }
  return createTokenAuth({
    token: sel.token,
    tokenPath: sel.tokenPath,
    devEmail: sel.devEmail,
    devBypass: sel.devBypass,
    host: sel.host,
  })
}
