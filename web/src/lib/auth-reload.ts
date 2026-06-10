// src/lib/auth-reload.ts
export const AUTH_RELOAD_FLAG = 'ocrc.authReloaded'

/**
 * CF Access session expired (a 401). Reload once so CF's interactive login
 * renders in the app window and bounces back. A sessionStorage flag prevents a
 * reload loop if login genuinely fails; clearAuthReloadFlag() is called on a
 * successful authed request so a later expiry can reload again.
 */
export function handleAuthFailure(loc: Pick<Location, 'reload'> = window.location): void {
  try {
    if (sessionStorage.getItem(AUTH_RELOAD_FLAG)) return
    sessionStorage.setItem(AUTH_RELOAD_FLAG, '1')
  } catch { /* sessionStorage unavailable — fall through to reload */ }
  loc.reload()
}

export function clearAuthReloadFlag(): void {
  try { sessionStorage.removeItem(AUTH_RELOAD_FLAG) } catch { /* ignore */ }
}
