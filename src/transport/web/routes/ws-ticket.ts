import type { Hono } from 'hono'
import { mintWsTicket } from '../ws-ticket.js'

export function registerWsTicket(app: Hono) {
  // Behind cfAccessMiddleware → c.get('user') is the authenticated identity.
  app.get('/api/ws-ticket', async (c) => {
    const user = c.get('user') as { email?: string; sub: string } | undefined
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    return c.json({ ticket: await mintWsTicket(user) })
  })
}
