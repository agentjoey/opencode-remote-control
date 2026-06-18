/**
 * connectAcp — the live wiring behind AcpBackend's `connect` factory. Spawns an
 * ACP agent (`kimi acp`, `gemini --acp`, …), builds a ClientSideConnection over
 * its stdio, runs `initialize`, and surfaces any advertised auth method.
 *
 * This is the untested glue layer (it spawns a real subprocess); the backend's
 * logic is unit-tested with an injected fake connection. See the dependency-free
 * probe in /tmp/acp-probe for the validated handshake, and ACP_BACKEND_DESIGN §12b.
 *
 * Auth nuance (validated against kimi): `initialize` advertising `authMethods`
 * does NOT mean auth is required — `session/new` succeeds when credentials exist.
 * So we DON'T authenticate eagerly here; we return `authMethodId` and let the
 * backend attempt the session, falling back to `authenticate` only on failure.
 */
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { AcpClient, AcpConnection } from './acp-backend.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('acp-connect')

export interface AcpSpawnConfig {
  /** e.g. 'kimi' / 'gemini'. */
  command: string
  /** e.g. ['acp'] / ['--acp']. */
  args: string[]
  /** Extra env for the child. */
  env?: Record<string, string>
}

/** Parse `OCRC_ACP_CMD="kimi acp"` → spawn config. */
export function parseAcpCommand(cmd: string): AcpSpawnConfig {
  const parts = cmd.trim().split(/\s+/)
  return { command: parts[0], args: parts.slice(1) }
}

/**
 * Build the `connect` factory AcpBackend expects, spawning the given agent.
 * The returned factory is called once (lazy) by the backend.
 */
export function makeAcpConnect(config: AcpSpawnConfig) {
  return async (client: AcpClient): Promise<{ conn: AcpConnection; authMethodId?: string }> => {
    const child = spawn(config.command, config.args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...config.env },
    })
    child.on('error', (e) => log.error(`acp spawn error (${config.command})`, e as Error))
    child.on('exit', (code) => log.warn(`acp agent exited: ${config.command} code=${code}`))

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
    )

    // The SDK delivers session/update + requestPermission to our client. We adapt
    // its method names (it passes ACP request objects) to AcpClient shape.
    const conn = new ClientSideConnection(
      () => ({
        sessionUpdate: (p: any) => client.sessionUpdate(p),
        requestPermission: (p: any) => client.requestPermission(p),
      }) as any,
      stream,
    )

    const init = await conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'ocrc', version: '0' },
    } as any)

    const authMethodId = (init as any)?.authMethods?.[0]?.id as string | undefined
    log.info(`acp connected: ${config.command} (auth advertised: ${authMethodId ?? 'none'})`)

    return { conn: conn as unknown as AcpConnection, authMethodId }
  }
}
