/**
 * BackendRegistry — holds the set of AgentBackends an OCRC instance serves and
 * resolves which one owns a given session. This is what makes in-UI backend
 * switching possible (Phase 3): the relay/routes/transports talk to the registry
 * instead of a single backend.
 *
 * Ownership resolution: session→backend is stored in SessionState (persisted), so
 * a session always routes back to the agent that created it across restarts. New
 * sessions are tagged at creation; pre-existing sessions are tagged when listed.
 * Untagged sessions fall back to the PRIMARY backend (the first registered, e.g.
 * opencode — its sessions pre-exist in the shared db and may not be tagged yet).
 */
import type { AgentBackend, BackendCapabilities } from './backend.js'
import type { SessionState } from '../state.js'

export interface BackendDescriptor {
  id: string
  capabilities: BackendCapabilities
}

export interface RegisteredBackend {
  id: string
  backend: AgentBackend
}

export interface BackendRegistry {
  /** Descriptors for every backend (id + capabilities), in registration order. */
  list(): BackendDescriptor[]
  /** Every registered backend, for fan-out (listSessions, onEvent wiring). */
  all(): RegisteredBackend[]
  get(id: string): AgentBackend | undefined
  has(id: string): boolean
  /** The primary backend — default owner of untagged sessions. */
  primaryId(): string
  /** The backend new sessions are created on: state.activeBackend → primary. */
  activeId(): string
  active(): AgentBackend
  /** Id of the backend that owns a session: stored tag → primary. */
  idForSession(sessionId: string): string
  /** The backend that owns a session. */
  forSession(sessionId: string): AgentBackend
  /** Tag a session's owning backend (called on create + when listing). */
  tag(sessionId: string, backendId: string): void
}

export interface BackendRegistryOpts {
  backends: RegisteredBackend[]
  state: SessionState
  /** Primary backend id; defaults to the first registered. */
  primaryId?: string
}

/**
 * A trivial registry over a single backend — every session resolves to it. For
 * single-backend callers (the opencode plugin, a one-agent host) and tests that
 * don't need session→backend persistence.
 */
export function singleBackendRegistry(backend: AgentBackend): BackendRegistry {
  return {
    list: () => [{ id: backend.id, capabilities: backend.capabilities }],
    all: () => [{ id: backend.id, backend }],
    get: (id) => (id === backend.id ? backend : undefined),
    has: (id) => id === backend.id,
    primaryId: () => backend.id,
    activeId: () => backend.id,
    active: () => backend,
    idForSession: () => backend.id,
    forSession: () => backend,
    tag: () => {},
  }
}

export function createBackendRegistry(opts: BackendRegistryOpts): BackendRegistry {
  const { state } = opts
  if (opts.backends.length === 0) throw new Error('BackendRegistry needs at least one backend')
  const byId = new Map(opts.backends.map((b) => [b.id, b.backend]))
  const primary = opts.primaryId && byId.has(opts.primaryId) ? opts.primaryId : opts.backends[0].id

  const resolveId = (sid: string): string => {
    const tagged = state.getSessionBackend(sid)
    if (tagged && byId.has(tagged)) return tagged
    return primary
  }

  return {
    list: () => opts.backends.map((b) => ({ id: b.id, capabilities: b.backend.capabilities })),
    all: () => opts.backends.slice(),
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    primaryId: () => primary,
    activeId: () => {
      const a = state.getActiveBackend()
      return a && byId.has(a) ? a : primary
    },
    active() {
      return byId.get(this.activeId())!
    },
    idForSession: resolveId,
    forSession: (sid) => byId.get(resolveId(sid))!,
    tag: (sid, backendId) => {
      if (byId.has(backendId) && state.getSessionBackend(sid) !== backendId) {
        state.setSessionBackend(sid, backendId)
      }
    },
  }
}
