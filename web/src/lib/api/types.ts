import type {
  ToolCall,
  AssistantMeta,
  InfoSection,
  Button,
  ContentBlock,
  StructuredCard,
} from '$shared/structured-card.js'

export type {
  ToolCall,
  AssistantMeta,
  InfoSection,
  Button,
  ContentBlock,
  StructuredCard,
}

/** The 'tool' / 'text' variants of a ContentBlock. */
export type ToolBlock = Extract<ContentBlock, { type: 'tool' }>
export type TextBlock = Extract<ContentBlock, { type: 'text' }>

export type ExtractStructuredCard<K extends StructuredCard['kind']> = Extract<StructuredCard, { kind: K }>

export interface SessionSummary {
  id: string
  title: string
  agent?: string
  model?: string
  cost?: number
  lastActiveAt: number
  unread: boolean
  directory?: string
  additions?: number
  deletions?: number
}
