import type { StructuredCard, SessionSummary } from './types.js'

let base = ''

export function setBaseUrl(url: string) {
  base = url.replace(/\/$/, '')
}

async function jsonGet<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`)
  return res.json()
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} ${res.status}`)
  return res.json()
}

export const api = {
  me: () => jsonGet<{ email: string }>('/api/me'),
  sessions: () => jsonGet<SessionSummary[]>('/api/sessions'),
  history: (id: string) => jsonGet<StructuredCard[]>(`/api/session/${id}`),
  diff: (id: string) => jsonGet<any[]>(`/api/session/${id}/diff`),
  todo: (id: string) => jsonGet<any[]>(`/api/session/${id}/todo`),
  context: (id: string) => jsonGet<{ sessionId: string; agent?: string; model?: string; tokens?: any; cost?: number; nextAgent?: string; nextModel?: any }>(`/api/session/${id}/context`),
  sendMessage: (body: { sessionId?: string; text: string }) => jsonPost<{ messageId: string }>('/api/message', body),
  abort: (sessionId: string) => jsonPost<{ ok: boolean }>('/api/abort', { sessionId }),
  approve: (sessionId: string, requestId: string, decision: 'once' | 'always' | 'reject') =>
    jsonPost<{ ok: boolean }>('/api/approval', { sessionId, requestId, decision }),
}
