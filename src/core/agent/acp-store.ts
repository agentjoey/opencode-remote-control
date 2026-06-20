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
  /** Working directory the session runs in. */
  directory: string
  createdAt: number
  updatedAt: number
  /** Finalized conversation cards (user + assistant), in order. */
  cards: StructuredCard[]
}

interface Persisted {
  sessions: Record<string, StoredSession>
  /** Session ids the user deleted. ACP agents (kimi) have no session/delete, so we
   *  hide these from session/list re-discovery instead of really deleting them. */
  tombstones?: string[]
}

export interface AcpStore {
  list(): Array<{ id: string; title: string; directory: string; createdAt: number; updatedAt: number }>
  /** Distinct directories that have sessions, with counts (for the workspace picker). */
  listDirectories(): Array<{ directory: string; sessionCount: number; lastActiveAt: number }>
  directoryOf(id: string): string | undefined
  has(id: string): boolean
  create(id: string, title?: string, directory?: string): void
  rename(id: string, title: string): void
  remove(id: string): void
  /** Mark a session deleted: remove it AND record a tombstone so session/list
   *  re-discovery won't resurrect it (kimi exposes no session/delete). */
  tombstone(id: string): void
  isTombstoned(id: string): boolean
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
      .map((s) => ({ id: s.id, title: s.title, directory: s.directory ?? '', createdAt: s.createdAt, updatedAt: s.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    listDirectories: () => {
      const byDir = new Map<string, { sessionCount: number; lastActiveAt: number }>()
      for (const s of Object.values(cache.sessions)) {
        const dir = s.directory ?? ''
        if (!dir) continue
        const e = byDir.get(dir) ?? { sessionCount: 0, lastActiveAt: 0 }
        e.sessionCount += 1
        e.lastActiveAt = Math.max(e.lastActiveAt, s.updatedAt)
        byDir.set(dir, e)
      }
      return [...byDir.entries()].map(([directory, e]) => ({ directory, ...e })).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    },
    directoryOf: (id) => cache.sessions[id]?.directory,
    has: (id) => id in cache.sessions,
    create: (id, title = '', directory = '') => {
      if (cache.sessions[id]) return
      const now = Date.now()
      cache.sessions[id] = { id, title, directory, createdAt: now, updatedAt: now, cards: [] }
      void persist()
    },
    rename: (id, title) => {
      const s = cache.sessions[id]
      if (s) { s.title = title; s.updatedAt = Date.now(); void persist() }
    },
    remove: (id) => {
      if (cache.sessions[id]) { delete cache.sessions[id]; void persist() }
    },
    tombstone: (id) => {
      cache.tombstones ??= []
      if (!cache.tombstones.includes(id)) cache.tombstones.push(id)
      delete cache.sessions[id]
      void persist()
    },
    isTombstoned: (id) => cache.tombstones?.includes(id) ?? false,
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
