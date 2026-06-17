import { writable } from 'svelte/store'
import { api } from '../api/client.js'

export interface CapabilitiesSnapshot {
  id: string
  capabilities: Record<string, boolean>
}

export const capabilities = writable<CapabilitiesSnapshot | null>(null)

export async function loadCapabilities(): Promise<void> {
  try {
    const snapshot = await api.capabilities()
    capabilities.set(snapshot)
  } catch (err) {
    // Capability metadata is optional UI chrome; fail silently.
    console.warn('[capabilities] failed to load', err)
  }
}
