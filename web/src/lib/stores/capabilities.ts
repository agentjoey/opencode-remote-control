import { writable, derived, get } from 'svelte/store'
import { api } from '../api/client.js'
import { sessionList } from './sessions.js'

export interface CapabilitiesSnapshot {
  id: string
  /** Friendly agent name shown in the console chrome. */
  name?: string
  /** Host / instance label (e.g. "mac-studio"). */
  host?: string
  /** Connection status reported by the backend. */
  status?: string
  capabilities: Record<string, boolean>
}

/** The active backend (new-session default) — kept for back-compat / fallback. */
export const capabilities = writable<CapabilitiesSnapshot | null>(null)

export interface BackendsSnapshot {
  backends: CapabilitiesSnapshot[]
  activeId: string
}

/** The full backend set + which one new sessions use (multi-backend). */
export const backends = writable<BackendsSnapshot | null>(null)

/**
 * The session the UI is currently viewing. Set by the layout from the route so
 * capability gating reflects the VIEWED session's backend (not a global). Plain
 * store (no `$app/stores` dependency) so it stays unit-testable.
 */
export const viewedSessionId = writable<string | undefined>(undefined)

/** Capabilities of the backend that owns the currently-viewed session. */
const currentCaps = derived(
  [backends, viewedSessionId, sessionList, capabilities],
  ([$backends, $sid, $list, $caps]): Record<string, boolean> | null => {
    if ($backends) {
      const row = $sid ? $list.find((s) => s.id === $sid) : undefined
      const id = row?.backendId ?? $backends.activeId
      const found = $backends.backends.find((b) => b.id === id)
      if (found) return found.capabilities
    }
    return $caps?.capabilities ?? null // fallback: active-backend caps
  },
)

/** Id of the backend that owns the currently-viewed session (or the active one). */
export const currentBackendId = derived(
  [backends, viewedSessionId, sessionList, capabilities],
  ([$backends, $sid, $list, $caps]): string | null => {
    if ($backends) {
      const row = $sid ? $list.find((s) => s.id === $sid) : undefined
      return row?.backendId ?? $backends.activeId
    }
    return $caps?.id ?? null
  },
)

/**
 * Feature gate. `$can('diff')` → false only when the owning backend EXPLICITLY
 * reports the feature off. Unknown/unloaded → true (assume supported), so the
 * opencode flagship never hides anything while metadata loads.
 */
export const can = derived(currentCaps, ($caps) => (feature: string): boolean => {
  if (!$caps) return true
  return $caps[feature] !== false
})

/** Capabilities of the ACTIVE backend (where NEW sessions are created). */
const activeCaps = derived([backends, capabilities], ([$backends, $caps]): Record<string, boolean> | null => {
  if ($backends) return $backends.backends.find((b) => b.id === $backends.activeId)?.capabilities ?? null
  return $caps?.capabilities ?? null
})

/** Feature gate for the ACTIVE backend — use for new-session affordances. */
export const canActive = derived(activeCaps, ($caps) => (feature: string): boolean => {
  if (!$caps) return true
  return $caps[feature] !== false
})

/** Friendly backend name for UI copy. `acp:kimi` → `kimi`. */
export const backendName = derived(currentBackendId, ($id) => {
  const id = $id ?? 'opencode'
  return id.includes(':') ? id.split(':').pop()! : id
})

/** Accent themes available for per-agent chrome theming. */
export const ACCENTS = ['emerald', 'azure', 'amber', 'violet'] as const
export type Accent = (typeof ACCENTS)[number]

const AGENT_ACCENT_KEY = 'ocrc.agentAccents'
const DEFAULT_AGENT_ACCENT: Record<string, Accent> = {
  opencode: 'emerald',
  'acp:kimi': 'azure',
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

/** Default accent for an agent when the user has not overridden it. */
export function defaultAccentForAgent(id: string): Accent {
  if (DEFAULT_AGENT_ACCENT[id]) return DEFAULT_AGENT_ACCENT[id]
  return ACCENTS[hashString(id) % ACCENTS.length]
}

function loadAgentAccentOverrides(): Record<string, Accent> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(AGENT_ACCENT_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function persistAgentAccentOverrides(map: Record<string, Accent>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(AGENT_ACCENT_KEY, JSON.stringify(map))
  } catch {
    /* ignore quota / privacy mode */
  }
}

/** Reactive source of truth for per-agent accent overrides. Components subscribe to
 *  this so glyph tiles / status dots re-theme the instant a swatch is clicked (reading
 *  localStorage directly is NOT reactive — that's what left the UI half-themed). */
export const accentOverrides = writable<Record<string, Accent>>(loadAgentAccentOverrides())

/** Resolved theme accent for a given agent (override or default). */
export function agentAccent(id: string): Accent {
  const overrides = get(accentOverrides)
  return ACCENTS.includes(overrides[id] as Accent) ? overrides[id] as Accent : defaultAccentForAgent(id)
}

/** Override (or revert to default via `null`) an agent's chrome accent. */
export function setAgentAccent(agentId: string, accent: Accent | null): void {
  const overrides = { ...get(accentOverrides) }
  if (accent && ACCENTS.includes(accent)) {
    overrides[agentId] = accent
  } else {
    delete overrides[agentId]
  }
  accentOverrides.set(overrides) // reactive → all theme consumers recompute
  persistAgentAccentOverrides(overrides)
  if (get(backends)?.activeId === agentId) {
    applyAgentTheme(agentId)
  }
}

/** Apply an agent's resolved accent to the document root. */
export function applyAgentTheme(agentId: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-accent', agentAccent(agentId))
}

export async function loadCapabilities(): Promise<void> {
  try {
    capabilities.set(await api.capabilities())
  } catch (err) {
    console.warn('[capabilities] failed to load', err)
  }
}

export async function loadBackends(): Promise<void> {
  try {
    backends.set(await api.backends())
  } catch (err) {
    console.warn('[backends] failed to load', err)
  }
}

/** Switch the active backend (new sessions) and refresh the snapshot. */
export async function setActiveBackend(backendId: string): Promise<void> {
  const snap = get(backends)
  if (snap) backends.set({ ...snap, activeId: backendId }) // optimistic
  try {
    await api.setActiveBackend(backendId)
  } catch (err) {
    console.warn('[backends] setActive failed', err)
  }
  await loadBackends()
  applyAgentTheme(backendId)
}
