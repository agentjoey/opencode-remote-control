// src/lib/auth-token.ts
//
// Token-based web auth (no Cloudflare Access dependency).
//
// The pairing URL (`oprc pair` / Telegram `/pair`) carries the token in the URL
// *fragment* (`#token=…`) so it never reaches the server, a proxy, or access
// logs. On first load we capture it into localStorage, strip it from the address
// bar, and thereafter attach it to every API request (`Authorization: Bearer`)
// and WebSocket connect (`?token=`). localStorage persists across an "install as
// app", so a paired device stays signed in.

const STORAGE_KEY = 'ocrc.token'

/** Parse a `token` value out of a URL fragment like `#token=abc` or `#a=1&token=abc`. */
export function readTokenFromHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  if (!h) return null
  const t = new URLSearchParams(h).get('token')
  return t && t.trim() ? t.trim() : null
}

export function getToken(): string | null {
  try {
    const t = localStorage.getItem(STORAGE_KEY)
    return t && t.trim() ? t : null
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try { localStorage.setItem(STORAGE_KEY, token) } catch { /* storage unavailable */ }
}

export function clearToken(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* storage unavailable */ }
}

/**
 * On app load: if the URL fragment carries a token, persist it and strip the
 * fragment from the address bar (so it isn't bookmarked or shoulder-surfed),
 * without reloading or pushing a history entry. Returns the active token —
 * the one just captured, or the previously stored one — if any.
 */
export function captureToken(
  loc: Location = window.location,
  hist: History = window.history,
): string | null {
  const fromHash = readTokenFromHash(loc.hash)
  if (fromHash) {
    setToken(fromHash)
    try { hist.replaceState(null, '', loc.pathname + loc.search) } catch { /* ignore */ }
    return fromHash
  }
  return getToken()
}
