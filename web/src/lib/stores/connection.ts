import { writable } from 'svelte/store'

export type ConnectionStatus = 'offline' | 'connected' | 'reconnecting'

export const connection = writable<ConnectionStatus>('offline')
