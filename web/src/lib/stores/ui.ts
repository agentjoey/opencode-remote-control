import { writable } from 'svelte/store'

/** Desktop left panel open/collapsed state. */
export const leftPanelOpen = writable(true)

/** "+ New" multi-action menu open state. */
export const plusMenuOpen = writable(false)

/** New-session modal open state. */
export const newSessionOpen = writable(false)
