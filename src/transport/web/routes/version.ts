import type { Hono } from 'hono'
import { getVersionInfo } from '../../../utils/version.js'

export function registerVersion(app: Hono) {
  app.get('/api/version', (c) => c.json(getVersionInfo()))
}
