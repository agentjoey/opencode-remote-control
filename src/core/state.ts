import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from '../utils/logger.js'

const log = createLogger('state')

interface PersistedState {
  lastSessionId?: string
  nextAgent?: string
  nextModel?: { providerID: string; modelID: string }
}

export interface SessionState {
  getLastSessionId(): string | undefined
  setLastSessionId(id: string | undefined): void
  getNextAgent(): string | undefined
  setNextAgent(name: string | undefined): void
  getNextModel(): { providerID: string; modelID: string } | undefined
  setNextModel(m: { providerID: string; modelID: string } | undefined): void
  flush(): Promise<void>
}

export function createFileBackedState(path: string): SessionState {
  let cache: PersistedState = load(path)
  let writeQueued: NodeJS.Timeout | undefined

  function persist(): Promise<void> {
    return new Promise((resolve) => {
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
        resolve()
      }, 100)
    })
  }

  return {
    getLastSessionId: () => cache.lastSessionId,
    setLastSessionId: (id) => {
      if (id === undefined) delete cache.lastSessionId
      else cache.lastSessionId = id
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
