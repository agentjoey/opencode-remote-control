import { existsSync } from 'node:fs'
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
  eventStream: EventStream
  cfAccess: { team: string; aud: string; devBypass?: boolean; devEmail?: string; host?: string }
  staticRoot: string
  cacheSize: number
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
      const wsHub = createWsHub({ cardBus: deps.cardBus })
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

      server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
        log.info(`web transport listening on http://${info.address}:${info.port}`)
      })

      wss = new WebSocketServer({ noServer: true })
      ;(server as any).on('upgrade', async (req: any, socket: any, head: any) => {
        if (req.url !== '/ws') { socket.destroy(); return }
        const user = await verifyUpgradeJwt(
          { headers: req.headers, url: req.url },
          { team: cfg.cfAccess.team, aud: cfg.cfAccess.aud, devBypass: cfg.cfAccess.devBypass, devEmail: cfg.cfAccess.devEmail, host: cfg.cfAccess.host ?? cfg.host },
        )
        if (!user) { socket.destroy(); return }
        wss!.handleUpgrade(req, socket, head, (ws) => {
          wsHub.attach(ws as any, user)
          ws.on('message', (data) => {
            try { wsHub.handleClientMessage(ws as any, JSON.parse(data.toString())) } catch {}
          })
          ws.on('close', () => wsHub.detach(ws as any))
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
