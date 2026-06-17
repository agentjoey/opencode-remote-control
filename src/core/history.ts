import type { StructuredCard, ContentBlock, AssistantMeta } from './structured-card.js'

export function summarizeToolArgs(tool: string, input: any): string {
  if (tool === 'bash') return (input?.command ?? '').slice(0, 60)
  if (tool === 'read' || tool === 'edit' || tool === 'write') return input?.filePath ?? ''
  if (tool === 'grep' || tool === 'find') return input?.pattern ?? input?.query ?? ''
  return ''
}

export function messageToCards(sessionId: string, msg: any): StructuredCard[] {
  // opencode SDK returns { info: {id, role, time, agent, model, ...}, parts: [...] }.
  const info = msg.info ?? msg
  const parts = msg.parts ?? info?.parts ?? []
  const role = info?.role

  if (role === 'user') {
    const textParts: string[] = []
    for (const part of parts) {
      if (part.type === 'text' && typeof part.text === 'string') {
        textParts.push(part.text)
      }
    }
    const ts = (typeof info.time?.created === 'number' ? info.time.created : info.ts) ?? Date.now()
    return [{
      kind: 'user',
      sessionId,
      text: textParts.join('') || '(empty)',
      ts,
    }]
  }

  if (role === 'assistant') {
    const blocks: ContentBlock[] = []
    for (const part of parts) {
      if (part.type === 'text' && typeof part.text === 'string') {
        blocks.push({ type: 'text', text: part.text })
      }
      if (part.type === 'tool' && typeof part.tool === 'string') {
        const status = part.state?.status ?? 'running'
        blocks.push({
          type: 'tool',
          tool: part.tool,
          args: summarizeToolArgs(part.tool, part.state?.input ?? {}),
          // opencode's terminal status is 'completed' (never 'done'); without
          // mapping it, finished tools stay 'running' and blink forever.
          status: status === 'error' ? 'error'
            : status === 'completed' || status === 'done' ? 'done'
            : 'running',
        })
      }
    }

    const meta: AssistantMeta = {}
    const agentName = typeof info.agent === 'string' ? info.agent : info.agent?.name
    if (agentName) meta.agent = agentName
    const modelStr = typeof info.model === 'string'
      ? info.model
      : info.model?.modelID ?? info.model?.id
    if (modelStr) meta.model = modelStr
    if (typeof info.cost === 'number') meta.cost = info.cost
    if (info.tokens) meta.tokens = info.tokens

    return [{
      kind: 'assistant',
      sessionId,
      blocks,
      meta,
    }]
  }

  return []
}

/**
 * Default cap on history depth. Long sessions (hundreds of messages with
 * subagent tool calls) blow up client-side rendering — 569-card sessions
 * froze the browser. Callers can pass `limit` to override.
 */
const DEFAULT_HISTORY_LIMIT = 50

export function cardsFromMessages(
  sessionId: string,
  messages: any[],
  limit: number = DEFAULT_HISTORY_LIMIT,
): StructuredCard[] {
  const recent = limit > 0 && messages.length > limit ? messages.slice(-limit) : messages
  const cards: StructuredCard[] = []
  for (const msg of recent) {
    cards.push(...messageToCards(sessionId, msg))
  }
  return cards
}
