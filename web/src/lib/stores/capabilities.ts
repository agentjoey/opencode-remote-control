import { writable, derived } from 'svelte/store'
import { api } from '../api/client.js'

export interface CapabilitiesSnapshot {
  id: string
  capabilities: Record<string, boolean>
}

export const capabilities = writable<CapabilitiesSnapshot | null>(null)

/**
 * Feature gate. `$can('diff')` → false only when the backend EXPLICITLY reports
 * the feature off. Unknown/unloaded → true (assume supported), so the opencode
 * flagship never hides anything while capabilities are still loading or if a new
 * flag isn't reported yet. ACP backends report the relevant flags false.
 */
export const can = derived(capabilities, ($c) => (feature: string): boolean => {
  const caps = $c?.capabilities
  if (!caps) return true
  return caps[feature] !== false
})

/**
 * Friendly backend name for UI copy. `acp:kimi` → `kimi`, `opencode` → `opencode`.
 * Falls back to `opencode` before capabilities load (the flagship default).
 */
export const backendName = derived(capabilities, ($c) => {
  const id = $c?.id ?? 'opencode'
  return id.includes(':') ? id.split(':').pop()! : id
})

export async function loadCapabilities(): Promise<void> {
  try {
    const snapshot = await api.capabilities()
    capabilities.set(snapshot)
  } catch (err) {
    // Capability metadata is optional UI chrome; fail silently.
    console.warn('[capabilities] failed to load', err)
  }
}
