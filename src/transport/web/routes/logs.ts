import type { Hono } from 'hono'
import { recentLogs } from '../../../utils/logger.js'

export function registerLogs(app: Hono) {
  app.get('/api/logs', (c) => {
    const limitRaw = Number(c.req.query('limit') ?? 200)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200
    return c.json({ lines: recentLogs(limit) })
  })
}
