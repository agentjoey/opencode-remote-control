import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from '../utils/logger.js'

const log = createLogger('state')

interface PersistedState {
  lastSessionId?: string
  pinnedSessionId?: string
  nextAgent?: string
  nextModel?: { providerID: string; modelID: string }
  tuiSelectedSession?: string
  currentAgent?: string
  activeWorkspace?: string
}

export interface SessionState {
  getLastSessionId(): string | undefined
  setLastSessionId(id: string | undefined): void
  getPinnedSessionId(): string | undefined
  setPinnedSessionId(id: string | undefined): void
  getNextAgent(): string | undefined
  setNextAgent(name: string | undefined): void
  getNextModel(): { providerID: string; modelID: string } | undefined
  setNextModel(m: { providerID: string; modelID: string } | undefined): void
  getTuiSelectedSession(): string | undefined
  setTuiSelectedSession(id: string | undefined): void
  getCurrentAgent(): string | undefined
  setCurrentAgent(name: string | undefined): void
  getActiveWorkspace(): string | undefined
  setActiveWorkspace(dir: string | undefined): void
  getActiveAbort(sessionId: string): AbortController | undefined
  setActiveAbort(sessionId: string, ac: AbortController | undefined): void
  /** True while any session has an in-flight generation (abort registered). */
  hasActiveGeneration(): boolean
  /** Record that the relay just delivered an assistant card for this session. */
  markAssistantDelivered(sessionId: string): void
  /** Epoch ms of the last relay-delivered assistant card for this session. */
  getAssistantDeliveredAt(sessionId: string): number | undefined
  /** Free all in-memory per-session bookkeeping for a deleted session. */
  dropSession(sessionId: string): void
  getSessionCost(sessionId: string): number | undefined
  setSessionCost(sessionId: string, cost: number | undefined): void
  flush(): Promise<void>
}

export function createFileBackedState(path: string): SessionState {
  let cache: PersistedState = load(path)
  let writeQueued: NodeJS.Timeout | undefined
  let pending: Promise<void> | undefined
  let resolvePending: (() => void) | undefined
  const aborts = new Map<string, AbortController>()
  const sessionCosts = new Map<string, number>()
  const assistantDeliveredAt = new Map<string, number>()

  // Debounced atomic write. All set() calls within the debounce window share a
  // single pending promise that resolves once the write lands — earlier code
  // created a fresh promise per call and cleared the prior timer, so every
  // promise but the last never resolved (flush()'s await could hang).
  function persist(): Promise<void> {
    if (!pending) {
      pending = new Promise<void>((res) => { resolvePending = res })
    }
    if (writeQueued) clearTimeout(writeQueued)
    writeQueued = setTimeout(() => {
      try {
        mkdirSync(dirname(path), { recursive: true })
        const tmp = `${path}.tmp`
        writeFileSync(tmp, JSON.stringify(cache, null, 2))
        renameSync(tmp, path)
      } catch (err) {
        log.warn('failed to persist state', (err as Error).message)
      }
      writeQueued = undefined
      const res = resolvePending
      pending = undefined
      resolvePending = undefined
      res?.()
    }, 100)
    return pending
  }

  return {
    getLastSessionId: () => cache.lastSessionId,
    setLastSessionId: (id) => {
      if (id === undefined) delete cache.lastSessionId
      else cache.lastSessionId = id
      void persist()
    },
    getPinnedSessionId: () => cache.pinnedSessionId,
    setPinnedSessionId: (id) => {
      if (id === undefined) delete cache.pinnedSessionId
      else cache.pinnedSessionId = id
      void persist()
    },
    getNextAgent: () => cache.nextAgent,
    setNextAgent: (name) => {
      if (name === undefined) delete cache.nextAgent
      else cache.nextAgent = name
      void persist()
    },
    getNextModel: () => cache.nextModel,
    setNextModel: (m) => {
      if (m === undefined) delete cache.nextModel
      else cache.nextModel = m
      void persist()
    },
    getTuiSelectedSession: () => cache.tuiSelectedSession,
    setTuiSelectedSession: (id) => {
      if (id === undefined) delete cache.tuiSelectedSession
      else cache.tuiSelectedSession = id
      void persist()
    },
    getCurrentAgent: () => cache.currentAgent,
    setCurrentAgent: (name) => {
      if (name === undefined) delete cache.currentAgent
      else cache.currentAgent = name
      void persist()
    },
    getActiveWorkspace: () => cache.activeWorkspace,
    setActiveWorkspace: (dir) => {
      if (dir === undefined) delete cache.activeWorkspace
      else cache.activeWorkspace = dir
      void persist()
    },
    getActiveAbort: (sid) => aborts.get(sid),
    setActiveAbort: (sid, ac) => {
      if (ac === undefined) aborts.delete(sid)
      else aborts.set(sid, ac)
    },
    hasActiveGeneration: () => aborts.size > 0,
    markAssistantDelivered: (sid) => { assistantDeliveredAt.set(sid, Date.now()) },
    getAssistantDeliveredAt: (sid) => assistantDeliveredAt.get(sid),
    dropSession: (sid) => {
      aborts.get(sid)?.abort()
      aborts.delete(sid)
      sessionCosts.delete(sid)
      assistantDeliveredAt.delete(sid)
      let dirty = false
      if (cache.lastSessionId === sid) { delete cache.lastSessionId; dirty = true }
      if (cache.pinnedSessionId === sid) { delete cache.pinnedSessionId; dirty = true }
      if (cache.tuiSelectedSession === sid) { delete cache.tuiSelectedSession; dirty = true }
      if (dirty) void persist()
    },
    getSessionCost: (sid) => sessionCosts.get(sid),
    setSessionCost: (sid, cost) => {
      if (cost === undefined) sessionCosts.delete(sid)
      else sessionCosts.set(sid, cost)
    },
    flush: async () => persist(),
  }
}

function load(path: string): PersistedState {
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw) as PersistedState
  } catch (err) {
    log.warn(`state file malformed, treating as empty: ${(err as Error).message}`)
    return {}
  }
}
