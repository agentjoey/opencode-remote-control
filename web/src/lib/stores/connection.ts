import { writable } from 'svelte/store'

export type ConnectionStatus = 'offline' | 'connected' | 'reconnecting'

export const connection = writable<ConnectionStatus>('offline')
/** Last measured WS round-trip latency in milliseconds (0 if not yet measured). */
export const latency = writable<number>(0)
