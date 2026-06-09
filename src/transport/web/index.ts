import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve, type ServerType } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { serveStatic } from '@hono/node-server/serve-static'
import type { OpencodeClient } from '@opencode-ai/sdk'
import type { IncomingMessage, ChannelCapabilities } from '../../core/types.js'
import type { Transport, TransportStartDeps } from '../interface.js'
import type { StructuredCard } from '../../core/structured-card.js'
import type { EventStream } from '../../opencode/event-stream.js'
import { buildServer } from './server.js'
import { createWsHub } from './ws-hub.js'
import { createLogger } from '../../utils/logger.js'
import { verifyUpgradeJwt } from './middleware/cf-access.js'

const log = createLogger('web')

export interface WebTransportConfig {
  host: string
  port: number
  client: OpencodeClient
  cfAccess: { team: string; aud: string; devBypass?: boolean; devEmail?: string; host?: string }
  staticRoot: string
  cacheSize: number
  /** EventStream — required for legacy sidecar mode, optional for Plugin mode. */
  eventStream?: EventStream
}

const CAPS: ChannelCapabilities = {
  edit: true, maxMessageLength: Number.POSITIVE_INFINITY,
  buttons: true, richText: true, streaming: true,
}

export function createWebTransport(cfg: WebTransportConfig): Transport {
  let messageHandler: ((msg: IncomingMessage) => Promise<void>) | undefined
  let server: ServerType | undefined
  let wss: WebSocketServer | undefined

  return {
    name: 'web',
    capabilities: CAPS,
    async start(deps: TransportStartDeps) {
      if (!existsSync(cfg.staticRoot)) {
        throw new Error(`Web static root not found: ${cfg.staticRoot}. Run 'cd web && npm run build' first.`)
      }
      const wsHub = createWsHub({ cardBus: deps.cardBus, client: cfg.client, state: deps.state })
      const app = buildServer({
        cfAccess: { ...cfg.cfAccess, host: cfg.cfAccess.host ?? cfg.host },
        client: cfg.client,
        state: deps.state,
        cardBus: deps.cardBus,
        wsHub,
        cacheSize: cfg.cacheSize,
        onMessage: (msg) => messageHandler ? messageHandler(msg) : Promise.resolve(),
      })

      app.use('/*', serveStatic({ root: cfg.staticRoot }))

      // SPA fallback — SvelteKit static adapter only prerenders index.html;
      // dynamic routes like /[sessionId]/ resolve client-side, so any non-API
      // path that doesn't match a real file must serve index.html.
      // Critical: ONLY fall back navigation-style paths. If a missing asset
      // (e.g. stale /_app/old-hash.js a cached browser still asks for) gets
      // index.html, the browser sees text/html where it expects JS and the
      // whole module graph silently stalls.
      const indexHtmlPath = join(cfg.staticRoot, 'index.html')
      app.get('*', (c) => {
        const path = c.req.path
        if (path.startsWith('/api/') || path === '/ws') return c.notFound()
        const filePath = join(cfg.staticRoot, path)
        if (existsSync(filePath)) {
          return new Response(readFileSync(filePath))
        }
        return c.html(readFileSync(indexHtmlPath, 'utf-8'))
      })

      server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
        log.info(`web transport listening on http://${info.address}:${info.port}`)
      })

      wss = new WebSocketServer({ noServer: true })
      ;(server as any).on('upgrade', async (req: any, socket: any, head: any) => {
        const hasCookie = !!req.headers?.cookie
        const hasAccessHdr = !!req.headers?.['cf-access-jwt-assertion']
        log.info(`ws upgrade attempt url=${req.url} cookie=${hasCookie} cf-access-hdr=${hasAccessHdr}`)
        if (req.url !== '/ws') {
          log.info(`ws upgrade rejected: wrong url=${req.url}`)
          socket.destroy()
          return
        }
        const user = await verifyUpgradeJwt(
          { headers: req.headers, url: req.url, socket: req.socket },
          { team: cfg.cfAccess.team, aud: cfg.cfAccess.aud, devBypass: cfg.cfAccess.devBypass, devEmail: cfg.cfAccess.devEmail },
        )
        if (!user) {
          log.warn(`ws upgrade rejected: JWT verify failed (cookie=${hasCookie} cf-access-hdr=${hasAccessHdr})`)
          socket.destroy()
          return
        }
        log.info(`ws upgrade accepted: ${user.email}`)
        wss!.handleUpgrade(req, socket, head, (ws) => {
          log.info(`ws handleUpgrade callback fired, attaching`)
          wsHub.attach(ws as any, user)
          ws.on('message', (data) => {
            try { wsHub.handleClientMessage(ws as any, JSON.parse(data.toString())) } catch {}
          })
          ws.on('close', (code, reason) => {
            log.info(`ws closed code=${code} reason="${reason.toString()}"`)
            wsHub.detach(ws as any)
          })
          ws.on('error', (err) => log.warn(`ws error: ${err.message}`))
        })
      })
    },
    async stop() {
      wss?.close()
      server?.close()
    },
    async send(_chatId, _card: StructuredCard) {
      throw new Error('Transport.send not implemented for Web in v0.5.0 (use cardBus.publish)')
    },
    onMessage(h) { messageHandler = h },
    onCommand() { },
    onButtonClick() { },
  }
}
