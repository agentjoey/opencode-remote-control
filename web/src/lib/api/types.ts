import type {
  ToolCall,
  AssistantMeta,
  InfoSection,
  Button,
  StructuredCard,
} from '$shared/structured-card.js'

export type {
  ToolCall,
  AssistantMeta,
  InfoSection,
  Button,
  StructuredCard,
}

export type ExtractStructuredCard<K extends StructuredCard['kind']> = Extract<StructuredCard, { kind: K }>

export interface SessionSummary {
  id: string
  title: string
  agent?: string
  model?: string
  cost?: number
  lastActiveAt: number
  unread: boolean
}
