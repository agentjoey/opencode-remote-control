import type { Hono } from 'hono'
import type { IncomingMessage } from '../../../core/types.js'

export function registerMessage(
  app: Hono,
  onMessage: (msg: IncomingMessage) => Promise<void>,
) {
  app.post('/api/message', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { sessionId?: string; text?: string; clientId?: string }
    if (typeof body.text !== 'string' || body.text.trim() === '') {
      return c.json({ error: 'text required' }, 400)
    }
    const user = c.get('user') as { email: string; sub: string }
    // Use the client-supplied id so the echoed user card carries the same id as
    // the optimistic card the UI already inserted — they reconcile (no dupe).
    const messageId = typeof body.clientId === 'string' && body.clientId ? body.clientId : `web_${Date.now()}`
    const msg: IncomingMessage = {
      userId: user.sub ?? user.email,
      chatId: `web:${user.email}`,
      text: body.text,
      messageId,
      // Route to the session the web UI is viewing, not the global pinned one,
      // so web and Telegram can converse with different sessions independently.
      sessionId: typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined,
      origin: 'web',
    }
    void onMessage(msg)
    return c.json({ messageId })
  })
}
