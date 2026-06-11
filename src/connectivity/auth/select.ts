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
    return createCfAccessAuth(sel.cfAccess ?? ({ team: '', aud: '' } as CfAccessOpts))
  }
  return createTokenAuth({
    token: sel.token,
    tokenPath: sel.tokenPath,
    devEmail: sel.devEmail,
    devBypass: sel.devBypass,
    host: sel.host,
  })
}
