import { writable } from 'svelte/store'

// Pinned session ids, persisted client-side. Pinning is a personal UI
// preference, so it lives in localStorage rather than on the server.
const KEY = 'ocrc.pinnedSessions'

function load(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function persist(ids: string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    /* quota / privacy mode — pins simply won't persist */
  }
}

function createPins() {
  const { subscribe, update } = writable<string[]>(load())
  return {
    subscribe,
    toggle(id: string) {
      update((ids) => {
        const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
        persist(next)
        return next
      })
    },
  }
}

export const pinnedSessions = createPins()
