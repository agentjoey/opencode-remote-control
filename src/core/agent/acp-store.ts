/**
 * Persistent session + history store for ACP backends.
 *
 * ACP agents (kimi) persist a session well enough to `resumeSession` across
 * connections, but DON'T expose a session list and DON'T replay history. So to
 * give ACP sessions the same long-lived, reopenable experience as opencode
 * (which persists everything server-side), OCRC persists it itself: the session
 * list (id + title) and the rendered conversation cards, keyed by session id.
 *
 * File-backed JSON with debounced atomic writes (mirrors core/state.ts).
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { StructuredCard } from '../structured-card.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('acp-store')

interface StoredSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Finalized conversation cards (user + assistant), in order. */
  cards: StructuredCard[]
}

interface Persisted {
  sessions: Record<string, StoredSession>
}

export interface AcpStore {
  list(): Array<{ id: string; title: string; createdAt: number; updatedAt: number }>
  has(id: string): boolean
  create(id: string, title?: string): void
  rename(id: string, title: string): void
  remove(id: string): void
  getCards(id: string): StructuredCard[]
  /** Append/replace a finalized card (dedupe by card.id) and bump updatedAt. */
  recordCard(id: string, card: StructuredCard, now: number): void
  flush(): Promise<void>
}

export function createAcpStore(path: string): AcpStore {
  let cache: Persisted = load(path)
  let pending: Promise<void> | undefined
  let resolvePending: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function persist(): Promise<void> {
    if (!pending) pending = new Promise<void>((res) => { resolvePending = res })
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        mkdirSync(dirname(path), { recursive: true })
        const tmp = `${path}.tmp`
        writeFileSync(tmp, JSON.stringify(cache))
        renameSync(tmp, path)
      } catch (err) {
        log.warn(`failed to persist acp store: ${(err as Error).message}`)
      }
      timer = undefined
      const res = resolvePending
      pending = undefined; resolvePending = undefined
      res?.()
    }, 200)
    return pending
  }

  return {
    list: () => Object.values(cache.sessions)
      .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    has: (id) => id in cache.sessions,
    create: (id, title = '') => {
      if (cache.sessions[id]) return
      const now = Date.now()
      cache.sessions[id] = { id, title, createdAt: now, updatedAt: now, cards: [] }
      void persist()
    },
    rename: (id, title) => {
      const s = cache.sessions[id]
      if (s) { s.title = title; s.updatedAt = Date.now(); void persist() }
    },
    remove: (id) => {
      if (cache.sessions[id]) { delete cache.sessions[id]; void persist() }
    },
    getCards: (id) => cache.sessions[id]?.cards ?? [],
    recordCard: (id, card, now) => {
      const s = cache.sessions[id]
      if (!s) return
      const cid = (card as { id?: string }).id
      const i = cid ? s.cards.findIndex((c) => (c as { id?: string }).id === cid) : -1
      if (i >= 0) s.cards[i] = card
      else s.cards.push(card)
      s.updatedAt = now
      void persist()
    },
    flush: async () => persist(),
  }
}

function load(path: string): Persisted {
  if (!existsSync(path)) return { sessions: {} }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Persisted
  } catch (err) {
    log.warn(`acp store malformed, treating as empty: ${(err as Error).message}`)
    return { sessions: {} }
  }
}
