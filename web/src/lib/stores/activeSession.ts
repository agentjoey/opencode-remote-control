import { writable } from 'svelte/store'

function readCookie(): string | null {
  const m = document.cookie.match(/oprc_active_session=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

function writeCookie(value: string | null) {
  if (value) {
    const maxAge = 365 * 24 * 60 * 60
    document.cookie = `oprc_active_session=${encodeURIComponent(value)};path=/;max-age=${maxAge};SameSite=Lax`
  } else {
    document.cookie = 'oprc_active_session=;path=/;max-age=0;SameSite=Lax'
  }
}

function createActiveSessionStore() {
  const initial = readCookie()
  const { subscribe, set } = writable<string | null>(initial)

  return {
    subscribe,
    set(value: string | null) {
      writeCookie(value)
      set(value)
    },
  }
}

export const activeSession = createActiveSessionStore()
