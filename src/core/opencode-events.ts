/**
 * Minimal typed view of the opencode plugin events this app consumes.
 *
 * The SDK delivers events as loosely-typed `{ type, properties }`. Rather than
 * sprinkle `as any` at every `properties` access in relay/push/handlers, narrow
 * to these shapes once. Fields are optional because event variants differ and
 * the SDK has changed field names across versions (sessionID vs sessionId,
 * permissionID vs requestID) — read defensively via the helpers below.
 */

export interface OcPart {
  id?: string
  type?: string
  text?: string
  tool?: string
  messageID?: string
  sessionID?: string
  state?: { status?: string; input?: Record<string, unknown>; output?: unknown }
}

export interface OcEventProps {
  sessionID?: string
  sessionId?: string
  part?: OcPart
  partID?: string
  field?: string
  delta?: string
  messageID?: string
  info?: { id?: string; sessionID?: string }
  status?: { type?: string }
  error?: { message?: string; name?: string; data?: { message?: string } }
  // permission events
  id?: string
  title?: string
  permission?: unknown
  args?: unknown
  response?: string
  reply?: string
  permissionID?: string
  requestID?: string
}

export interface OcEvent {
  type?: string
  properties?: OcEventProps
  [key: string]: unknown
}

/** Extract a session id from any event variant we handle. */
export function sessionIdOf(e: OcEvent): string | undefined {
  const p = e.properties
  if (!p) return undefined
  if (typeof p.sessionID === 'string') return p.sessionID
  if (typeof p.sessionId === 'string') return p.sessionId
  if (p.part && typeof p.part.sessionID === 'string') return p.part.sessionID
  if (p.info && typeof p.info.sessionID === 'string') return p.info.sessionID
  return undefined
}

/** Normalize a permission error/message into a display string. */
export function errorMessageOf(p: OcEventProps | undefined): string {
  return p?.error?.data?.message ?? p?.error?.message ?? p?.error?.name ?? (typeof (p as any)?.message === 'string' ? (p as any).message : undefined) ?? 'session error'
}
