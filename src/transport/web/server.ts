import { Hono } from 'hono'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { SessionState } from '../../core/state.js'
import type { CardBus } from '../../core/card-bus.js'
import type { IncomingMessage } from '../../core/types.js'
import { cfAccessMiddleware, type CfAccessOpts } from './middleware/cf-access.js'

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

export interface WsHub {
  attach(ws: any, user: { email: string }): void
  handleClientMessage(ws: any, msg: any): void
  detach(ws: any): void
  broadcast(msg: any): void
}

export interface BuildServerOpts {
  cfAccess: CfAccessOpts
  client: OpencodeClient
  state: SessionState
  cardBus: CardBus
  wsHub: WsHub
  cacheSize: number
  onMessage?: (msg: IncomingMessage) => Promise<void>
}

export function buildServer(opts: BuildServerOpts): Hono {
  const app = new Hono()
  app.use('/api/*', cfAccessMiddleware(opts.cfAccess))
  app.get('/api/me', (c) => {
    const user = c.get('user') as { email: string } | undefined
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    return c.json({ email: user.email })
  })
  registerSessions(app, opts.client, opts.state)
  registerSession(app, opts.client)
  if (opts.onMessage) registerMessage(app, opts.onMessage)
  registerAbort(app, opts.state)
  registerDiff(app, opts.client)
  registerTodo(app, opts.client)
  registerContext(app, opts.client, opts.state)
  registerApproval(app, opts.client)
  return app
}
