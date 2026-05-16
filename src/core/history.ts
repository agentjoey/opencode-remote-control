import type { OpencodeClient } from '@opencode-ai/sdk'
import type { StructuredCard, ToolCall, AssistantMeta } from './structured-card.js'

export function summarizeToolArgs(tool: string, input: any): string {
  if (tool === 'bash') return (input?.command ?? '').slice(0, 60)
  if (tool === 'read' || tool === 'edit' || tool === 'write') return input?.filePath ?? ''
  if (tool === 'grep' || tool === 'find') return input?.pattern ?? input?.query ?? ''
  return ''
}

export function messageToCards(sessionId: string, msg: any): StructuredCard[] {
  if (msg.role === 'user') {
    const textParts: string[] = []
    for (const part of msg.parts ?? []) {
      if (part.type === 'text' && typeof part.text === 'string') {
        textParts.push(part.text)
      }
    }
    return [{
      kind: 'user',
      sessionId,
      text: textParts.join('') || '(empty)',
      ts: msg.ts ?? Date.now(),
    }]
  }

  if (msg.role === 'assistant') {
    const textParts: string[] = []
    const tools: ToolCall[] = []
    for (const part of msg.parts ?? []) {
      if (part.type === 'text' && typeof part.text === 'string') {
        textParts.push(part.text)
      }
      if (part.type === 'tool' && typeof part.tool === 'string') {
        const status = part.state?.status ?? 'running'
        tools.push({
          tool: part.tool,
          args: summarizeToolArgs(part.tool, part.state?.input ?? {}),
          status: status === 'error' ? 'error' : status === 'done' ? 'done' : 'running',
        })
      }
    }

    const meta: AssistantMeta = {}
    if (msg.agent?.name) meta.agent = msg.agent.name
    if (msg.model) meta.model = msg.model
    if (typeof msg.cost === 'number') meta.cost = msg.cost
    if (msg.tokens) meta.tokens = msg.tokens

    const markdownSrc = textParts.join('')
    return [{
      kind: 'assistant',
      sessionId,
      markdownSrc,
      tools,
      meta,
    }]
  }

  return []
}

export async function reconstructHistory(client: OpencodeClient, sessionId: string): Promise<StructuredCard[]> {
  const res = await client.session.messages({ path: { id: sessionId } })
  const messages = (res.data ?? []) as any[]
  const cards: StructuredCard[] = []
  for (const msg of messages) {
    cards.push(...messageToCards(sessionId, msg))
  }
  return cards
}
