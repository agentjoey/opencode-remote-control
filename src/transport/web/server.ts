import { Hono } from 'hono'
import type { BackendRegistry } from '../../core/agent/registry.js'
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
import { registerControls } from './routes/controls.js'
import { registerFiles } from './routes/files.js'
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
  registry: BackendRegistry
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
  const reg = opts.registry
  // Backwards-compatible single-backend shape: the ACTIVE backend (the one new
  // sessions use). The frontend reads /api/backends for the full set + per-session
  // capabilities (each session row carries its backendId).
  app.get('/api/capabilities', (c) => {
    const active = reg.get(reg.activeId())!
    return c.json({ id: active.id, capabilities: active.capabilities })
  })
  // Multi-backend: the full backend set + which one new sessions go to.
  app.get('/api/backends', (c) => c.json({ backends: reg.list(), activeId: reg.activeId() }))
  app.post('/api/backends/active', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { backendId?: string }
    if (!body.backendId || !reg.has(body.backendId)) return c.json({ error: 'unknown backendId' }, 400)
    opts.state.setActiveBackend(body.backendId)
    return c.json({ ok: true, activeId: reg.activeId() })
  })
  registerSessions(app, reg, opts.state)
  registerSession(app, reg, opts.cardBus)
  if (opts.onMessage) registerMessage(app, opts.onMessage)
  registerAbort(app, reg, opts.state)
  registerDiff(app, reg)
  registerTodo(app, reg)
  registerControls(app, reg)
  registerFiles(app, reg)
  registerContext(app, reg, opts.state)
  registerApproval(app, reg)
  registerVersion(app)
  registerLogs(app)
  registerMcp(app, reg)
  registerCatalog(app, reg)
  registerOverrides(app, opts.state)
  registerWorkspaces(app, reg)
  registerCreateSession(app, reg)
  registerCommands(app, reg)
  registerRename(app, reg)
  return app
}
