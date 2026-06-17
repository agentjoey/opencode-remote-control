import { Hono } from 'hono'
import type { AgentBackend } from '../../core/agent/backend.js'
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
import { registerWorkspaces } from './routes/workspaces.js'
import { registerCreateSession } from './routes/create-session.js'
import { registerCommands } from './routes/commands.js'
import { registerRename } from './routes/rename.js'

export interface WsHub {
  attach(ws: any, user: { email: string }): void
  handleClientMessage(ws: any, msg: any): void
  detach(ws: any): void
  broadcast(msg: any): void
}

export interface BuildServerOpts {
  auth: AuthStrategy
  backend: AgentBackend
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
  app.get('/api/capabilities', (c) =>
    c.json({ id: opts.backend.id, capabilities: opts.backend.capabilities }))
  registerSessions(app, opts.backend, opts.state)
  registerSession(app, opts.backend, opts.cardBus)
  if (opts.onMessage) registerMessage(app, opts.onMessage)
  registerAbort(app, opts.backend, opts.state)
  registerDiff(app, opts.backend)
  registerTodo(app, opts.backend)
  registerContext(app, opts.backend, opts.state)
  registerApproval(app, opts.backend)
  registerVersion(app)
  registerLogs(app)
  registerMcp(app, opts.backend)
  registerCatalog(app, opts.backend)
  registerOverrides(app, opts.state)
  registerWorkspaces(app, opts.backend)
  registerCreateSession(app, opts.backend)
  registerCommands(app, opts.backend)
  registerRename(app, opts.backend)
  return app
}
