import { writable } from 'svelte/store'

export interface WorkspaceSummary {
  directory: string
  name: string
  sessionCount: number
  lastActiveAt: number
}

export const workspaces = writable<WorkspaceSummary[]>([])
/** Selected workspace directory, or null for "all". */
export const activeWorkspace = writable<string | null>(null)
