export interface ToolCall {
  tool: string
  args: string
  status: 'running' | 'done' | 'error'
}

export interface AssistantMeta {
  agent?: string
  model?: string
  cost?: number
  tokens?: { input: number; output: number; cache?: number }
}

export interface InfoSection {
  heading?: string
  body: string
  code?: { language?: string; content: string }
}

export interface Button {
  label: string
  data: string
}

export type StructuredCard =
  | { kind: 'thinking';  sessionId: string;  showStop: boolean }
  | { kind: 'streaming'; sessionId: string;  markdownSrc: string;  tools: ToolCall[] }
  | { kind: 'assistant'; sessionId: string;  markdownSrc: string;  tools: ToolCall[]; meta: AssistantMeta }
  | { kind: 'user';      sessionId: string;  text: string;  ts: number }
  | { kind: 'error';     sessionId: string;  message: string }
  | { kind: 'status';    sessionId: string;  fields: Record<string, string>; buttons?: Button[][] }
  | { kind: 'info';      title: string;      sections: InfoSection[] }
  | { kind: 'approval';  sessionId: string;  title: string;  args: unknown;  requestId: string }
