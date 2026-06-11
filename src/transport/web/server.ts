import { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../core/state.js'
import type { CardBus } from '../../core/card-bus.js'
import type { IncomingMessage } from '../../core/types.js'
import type { AuthStrategy } from '../../connectivity/auth/index.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('web')

declare module 'hono' {
  interface ContextVariableMap {
    user: { email: string; sub: string }
  }
}
import { registerSessions } from './routes/sessions.js'
import { registerSession } from './routes/session.js'
import { registerMessage } from './routes/message.js'
import { registerAbort } from './routes/abort.js'
import { registerDiff } from './routes/diff.js'
import { registerTodo } from './routes/todo.js'
import { registerContext } from './routes/context.js'
import { registerApproval } from './routes/approval.js'
import { registerVersion } from './routes/version.js'
import { registerLogs } from './routes/logs.js'
import { registerMcp } from './routes/mcp.js'
import { registerCatalog } from './routes/catalog.js'
import { registerOverrides } from './routes/overrides.js'

export interface WsHub {
  attach(ws: any, user: { email: string }): void
  handleClientMessage(ws: any, msg: any): void
  detach(ws: any): void
  broadcast(msg: any): void
}

export interface BuildServerOpts {
  auth: AuthStrategy
  client: OpencodeClient
  state: SessionState
  cardBus: CardBus
  wsHub: WsHub
  cacheSize: number
  baseUrl: string
  onMessage?: (msg: IncomingMessage) => Promise<void>
}

export function buildServer(opts: BuildServerOpts): Hono {
  const app = new Hono()
  app.use('/api/*', async (c, next) => {
    const t0 = Date.now()
    await next()
    log.info(`${c.req.method} ${c.req.path} → ${c.res.status} ${Date.now() - t0}ms`)
  })
  app.use('/api/*', opts.auth.httpMiddleware())
  app.get('/api/me', (c) => {
    const user = c.get('user') as { email: string } | undefined
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    return c.json({ email: user.email })
  })
  registerSessions(app, opts.client, opts.state)
  registerSession(app, opts.client, opts.cardBus)
  if (opts.onMessage) registerMessage(app, opts.onMessage)
  registerAbort(app, opts.client, opts.state)
  registerDiff(app, opts.client)
  registerTodo(app, opts.client)
  registerContext(app, opts.client, opts.state)
  registerApproval(app, opts.client)
  registerVersion(app)
  registerLogs(app)
  registerMcp(app, opts.client)
  registerCatalog(app, opts.client)
  registerOverrides(app, opts.state)
  return app
}
