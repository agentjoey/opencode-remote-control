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

/** A single block in a streaming or final assistant message. Order matters. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: string; args: string; status: 'running' | 'done' | 'error' }

export type StructuredCard =
  | { kind: 'thinking';     sessionId: string;  showStop: boolean }
  | { kind: 'think-stream'; sessionId: string;  thinkingText: string }
  | { kind: 'streaming';    sessionId: string;  blocks: ContentBlock[] }
  | { kind: 'assistant';    sessionId: string;  blocks: ContentBlock[]; meta: AssistantMeta }
  | { kind: 'user';         sessionId: string;  text: string;  ts: number }
  | { kind: 'error';        sessionId: string;  message: string }
  | { kind: 'status';       sessionId: string;  fields: Record<string, string>; buttons?: Button[][] }
  | { kind: 'info';         title: string;      sections: InfoSection[]; sessionId?: string }
  | { kind: 'approval';     sessionId: string;  title: string;  args: unknown;  requestId: string }
