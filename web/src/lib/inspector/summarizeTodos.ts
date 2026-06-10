export type TodoStatus = 'done' | 'running' | 'pending'
export interface TodoItem { text: string; status: TodoStatus }
export interface TodoSummary { total: number; done: number; items: TodoItem[] }

function mapStatus(s: unknown): TodoStatus {
  const v = String(s ?? '').toLowerCase()
  if (v === 'completed' || v === 'done') return 'done'
  if (v === 'in_progress' || v === 'running' || v === 'active') return 'running'
  return 'pending'
}

export function summarizeTodos(raw: any[]): TodoSummary {
  const list = Array.isArray(raw) ? raw : []
  const items: TodoItem[] = list.map((t) => ({
    text: String(t?.content ?? t?.text ?? t?.title ?? ''),
    status: mapStatus(t?.status),
  }))
  return { total: items.length, done: items.filter((i) => i.status === 'done').length, items }
}
