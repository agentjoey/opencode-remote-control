/**
 * Builds the backend set for the standalone host from an OCRC_BACKENDS spec and
 * wires each backend's event source to the relay. This is what lets one host
 * serve multiple agents (opencode + kimi + …) with in-UI switching (Phase 3).
 *
 * Event sources differ by backend:
 *  - ACP backends own their stream (backend.onEvent → relay; busy/idle → push).
 *  - opencode has no onEvent: the host spawns its OWN opencode server
 *    (createOpencodeServer — validated reachable from a standalone process) and
 *    consumes the global event SSE, normalizing → relay and forwarding permission
 *    events to the approval bridge. opencode events feed push natively.
 */
import { createOpencodeServer, createOpencodeClient } from '@opencode-ai/sdk'
import type { AgentEvent } from '../core/agent/event.js'
import type { RegisteredBackend } from '../core/agent/registry.js'
import { createAcpBackend, type AcpPermissionRequest } from '../core/agent/acp-backend.js'
import type { AcpStore } from '../core/agent/acp-store.js'
import { makeAcpConnect, parseAcpCommand } from '../core/agent/acp-connect.js'
import { createOpencodeBackend } from '../core/agent/opencode-backend.js'
import { normalizeOpencodeEvent } from '../core/agent/opencode-normalizer.js'
import { startGlobalEvents } from '../opencode/global-events.js'
import type { OcEvent } from '../core/opencode-events.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('host-backends')

export interface BackendSpec {
  id: string
  kind: 'opencode' | 'acp'
  /** ACP spawn command (e.g. "kimi acp"); unused for opencode. */
  command?: string
}

/**
 * Parse OCRC_BACKENDS. Entries: `opencode` or `<id>=<acp command>`. When empty,
 * falls back to a single ACP backend from OCRC_ACP_CMD (legacy single-backend host).
 */
export function parseBackendsSpec(spec: string, fallbackAcpCmd: string): BackendSpec[] {
  const entries = spec.split(',').map((s) => s.trim()).filter(Boolean)
  if (entries.length === 0) {
    const cmd = parseAcpCommand(fallbackAcpCmd)
    return [{ id: `acp:${cmd.command}`, kind: 'acp', command: fallbackAcpCmd }]
  }
  return entries.map((e): BackendSpec => {
    if (e === 'opencode') return { id: 'opencode', kind: 'opencode' }
    const eq = e.indexOf('=')
    if (eq === -1) {
      const cmd = parseAcpCommand(e)
      return { id: `acp:${cmd.command}`, kind: 'acp', command: e }
    }
    const rawId = e.slice(0, eq).trim()
    const command = e.slice(eq + 1).trim()
    return { id: rawId.includes(':') ? rawId : `acp:${rawId}`, kind: 'acp', command }
  })
}

export interface RelayLike { handleEvent(e: AgentEvent): Promise<void> }
export interface PushLike { handleEvent(ev: unknown): void }

export interface BuildHostBackendsDeps {
  cwd: string
  /** ACP permission bridge (shared by all ACP backends). */
  onAcpPermission: (req: AcpPermissionRequest) => Promise<string | null>
  /** Persistent session+history store, shared by all ACP backends. */
  store?: AcpStore
  /** Base port for spawned opencode servers (each opencode backend gets one). */
  opencodePort?: number
}

export interface BuiltHostBackends {
  backends: RegisteredBackend[]
  /**
   * Wire every backend's event source to the relay + push. `onOpencodePermission`
   * receives raw opencode permission events to forward to the approval UI.
   * Returns a disposer that tears down all sources + spawned servers.
   */
  wire(relay: RelayLike, push: PushLike, onOpencodePermission: (ev: OcEvent) => void): () => Promise<void>
}

const PERMISSION_TYPES = new Set(['permission.asked', 'permission.updated', 'permission.replied'])

export async function buildHostBackends(specs: BackendSpec[], deps: BuildHostBackendsDeps): Promise<BuiltHostBackends> {
  const backends: RegisteredBackend[] = []
  const opencodeServers: Array<{ id: string; client: any; close: () => Promise<void> }> = []
  let nextPort = deps.opencodePort ?? 4096

  for (const spec of specs) {
    if (spec.kind === 'opencode') {
      try {
        const server = await createOpencodeServer({ hostname: '127.0.0.1', port: nextPort++, timeout: 15000 })
        const client = createOpencodeClient({ baseUrl: server.url })
        const backend = createOpencodeBackend({ client, baseUrl: server.url })
        backends.push({ id: spec.id, backend })
        opencodeServers.push({ id: spec.id, client, close: async () => { try { await server.close() } catch { /* noop */ } } })
        log.info(`opencode backend ready @ ${server.url}`)
      } catch (err) {
        log.error(`failed to start opencode backend (skipping): ${(err as Error).message}`)
      }
    } else {
      const backend = createAcpBackend({
        id: spec.id,
        cwd: deps.cwd,
        connect: makeAcpConnect(parseAcpCommand(spec.command ?? 'kimi acp')),
        onPermission: deps.onAcpPermission,
        store: deps.store,
      })
      backends.push({ id: spec.id, backend })
      log.info(`acp backend ready: ${spec.id} (${spec.command})`)
    }
  }

  if (backends.length === 0) throw new Error('host: no backends could be started')

  return {
    backends,
    wire(relay, push, onOpencodePermission) {
      const disposers: Array<() => void> = []

      // ACP backends: own their stream.
      for (const { backend } of backends) {
        if (!backend.onEvent) continue
        const off = backend.onEvent((e) => {
          relay.handleEvent(e).catch((err) => log.error('relay.handleEvent failed', err as Error))
          if (e.kind === 'idle') push.handleEvent({ type: 'session.idle', properties: { sessionID: e.sessionId } })
          else if (e.kind === 'part' || e.kind === 'delta') push.handleEvent({ type: 'session.status', properties: { sessionID: e.sessionId, status: { type: 'busy' } } })
        })
        disposers.push(off)
      }

      // opencode backends: pull the global event SSE.
      for (const { client } of opencodeServers) {
        const handle = startGlobalEvents({
          client,
          onEvent: (ev) => {
            push.handleEvent(ev) // opencode events are already the shape push expects
            if (PERMISSION_TYPES.has(ev.type ?? '')) { onOpencodePermission(ev); return }
            const ae = normalizeOpencodeEvent(ev)
            if (ae) relay.handleEvent(ae).catch((err) => log.error('relay.handleEvent failed', err as Error))
          },
        })
        disposers.push(() => handle.stop())
      }

      return async () => {
        for (const d of disposers) { try { d() } catch { /* noop */ } }
        for (const s of opencodeServers) await s.close()
      }
    },
  }
}
