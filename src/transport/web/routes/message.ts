import type { Hono } from 'hono'
import type { IncomingMessage } from '../../../core/types.js'

export function registerMessage(
  app: Hono,
  onMessage: (msg: IncomingMessage) => Promise<void>,
) {
  app.post('/api/message', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { sessionId?: string; text?: string }
    if (typeof body.text !== 'string' || body.text.trim() === '') {
      return c.json({ error: 'text required' }, 400)
    }
    const user = c.get('user') as { email: string; sub: string }
    const msg: IncomingMessage = {
      userId: user.sub ?? user.email,
      chatId: `web:${user.email}`,
      text: body.text,
      messageId: `web_${Date.now()}`,
    }
    void onMessage(msg)
    return c.json({ messageId: msg.messageId })
  })
}
