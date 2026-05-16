import { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../core/state.js'
import type { CardBus } from '../../core/card-bus.js'
import { cfAccessMiddleware, type CfAccessOpts } from './middleware/cf-access.js'

export interface WsHub {
  subscribe(fn: (msg: any) => void): () => void
  broadcast(msg: any): void
  attach?(server: any): void
}

export interface BuildServerOpts {
  cfAccess: CfAccessOpts
  client: OpencodeClient
  state: SessionState
  cardBus: CardBus
  wsHub: WsHub
  cacheSize: number
}

export function buildServer(opts: BuildServerOpts): Hono {
  const app = new Hono()

  // Apply CF Access middleware to /api/* routes
  app.use('/api/*', cfAccessMiddleware(opts.cfAccess))

  app.get('/api/me', async (c) => {
    const user = c.get('user') as { email: string } | undefined
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    return c.json({ email: user.email })
  })

  return app
}
