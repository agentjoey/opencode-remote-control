import type { StructuredCard, SessionSummary } from './types.js'
import { handleAuthFailure, clearAuthReloadFlag } from '../auth-reload.js'
import { getToken } from '../auth-token.js'

let base = ''

export function setBaseUrl(url: string) {
  base = url.replace(/\/$/, '')
}

// Attach the app token as a Bearer header when present (token-auth mode);
// `credentials: 'include'` keeps the CF Access cookie working when that mode is on.
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra ?? {}) }
  const t = getToken()
  if (t) h['authorization'] = `Bearer ${t}`
  return h
}

async function jsonGet<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { credentials: 'include', headers: authHeaders() })
  if (res.status === 401) { handleAuthFailure(); throw new Error(`GET ${path} 401`) }
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`)
  clearAuthReloadFlag()
  return res.json()
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (res.status === 401) { handleAuthFailure(); throw new Error(`POST ${path} 401`) }
  if (!res.ok) throw new Error(`POST ${path} ${res.status}`)
  clearAuthReloadFlag()
  return res.json()
}

export const api = {
  me: () => jsonGet<{ email: string }>('/api/me'),
  capabilities: () => jsonGet<{ id: string; capabilities: Record<string, boolean> }>('/api/capabilities'),
  backends: () => jsonGet<{ backends: { id: string; capabilities: Record<string, boolean> }[]; activeId: string }>('/api/backends'),
  setActiveBackend: (backendId: string) => jsonPost<{ ok: boolean; activeId: string }>('/api/backends/active', { backendId }),
  sessions: () => jsonGet<SessionSummary[]>('/api/sessions'),
  cleanupSubagents: () => jsonPost<{ deleted: number }>('/api/sessions/cleanup-subagents', {}),
  deleteSession: (id: string) => jsonPost<{ ok: boolean }>(`/api/sessions/${id}/delete`, {}),
  renameSession: (id: string, title: string) => jsonPost<{ ok: boolean }>(`/api/sessions/${id}/rename`, { title }),
  history: (id: string) => jsonGet<{ cards: StructuredCard[]; lastSeq: number }>(`/api/session/${id}`),
  diff: (id: string) => jsonGet<any[]>(`/api/session/${id}/diff`),
  todo: (id: string) => jsonGet<any[]>(`/api/session/${id}/todo`),
  context: (id: string) => jsonGet<{ sessionId: string; agent?: string; model?: string; tokens?: any; cost?: number; directory?: string; nextAgent?: string; nextModel?: any }>(`/api/session/${id}/context`),
  workspaces: () => jsonGet<Array<{ directory: string; name: string; sessionCount: number; lastActiveAt: number }>>('/api/workspaces'),
  createSession: (body: { directory: string; title?: string }) => jsonPost<{ id: string }>('/api/session', body),
  mcp: () => jsonGet<Array<{ name: string; type?: string; status: 'configured' | 'disabled' }>>('/api/mcp'),
  commands: () => jsonGet<Array<{ name: string; description: string }>>('/api/commands'),
  runCommand: (body: { sessionId: string; command: string; arguments?: string }) => jsonPost<{ ok: boolean }>('/api/command', body),
  agents: () => jsonGet<Array<{ name: string; model: string; description: string }>>('/api/agents'),
  models: () => jsonGet<Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>>('/api/models'),
  getOverrides: () => jsonGet<{ agent: string | null; model: { providerID: string; modelID: string } | null }>('/api/overrides'),
  setOverrides: (body: { agent?: string | null; model?: { providerID: string; modelID: string } | null }) =>
    jsonPost<{ ok: boolean }>('/api/overrides', body),
  sendMessage: (body: { sessionId?: string; text: string; clientId?: string }) => jsonPost<{ messageId: string }>('/api/message', body),
  abort: (sessionId: string) => jsonPost<{ ok: boolean }>('/api/abort', { sessionId }),
  approve: (sessionId: string, requestId: string, decision: 'once' | 'always' | 'reject') =>
    jsonPost<{ ok: boolean }>('/api/approval', { sessionId, requestId, decision }),
}
