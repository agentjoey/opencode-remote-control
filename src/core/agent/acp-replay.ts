/**
 * Rebuild conversation cards from a kimi `session/load` replay. kimi 0.18 replays a
 * session's full history as `session/update` notifications (user_message_chunk →
 * agent_thought/message_chunk → tool_call/tool_call_update) and resolves loadSession
 * when done. AcpBackend buffers those updates during a history-only load and hands
 * them here to produce the same {user, assistant} cards the live relay builds.
 *
 * Pure + synchronous so it's unit-testable without a live agent.
 */
import type { StructuredCard, ContentBlock } from '../structured-card.js'
import type { AcpUpdate } from './acp-normalizer.js'

function chunkText(content: AcpUpdate['content']): string {
  if (!content) return ''
  if (Array.isArray(content)) return content.map((c) => c?.content?.text ?? '').join('')
  return content.text ?? ''
}

function mapStatus(s?: string): 'running' | 'done' | 'error' {
  if (s === 'failed' || s === 'error') return 'error'
  if (s === 'completed' || s === 'success' || s === 'done') return 'done'
  return 'running'
}

/**
 * Group a replayed update stream into ordered cards. Each user message opens a user
 * card; the agent thought/message/tool updates that follow accumulate into one
 * assistant card until the next user message. (agent_thought_chunk is omitted —
 * transient reasoning isn't shown in finalized history.)
 */
export function buildReplayCards(sessionId: string, updates: AcpUpdate[], now: number): StructuredCard[] {
  const cards: StructuredCard[] = []
  let pendingUserText: string | null = null
  let asst: ContentBlock[] | null = null
  const toolIdx = new Map<string, number>()
  let u = 0
  let a = 0

  const flushUser = () => {
    if (pendingUserText != null) {
      cards.push({ kind: 'user', sessionId, text: pendingUserText, ts: now, id: `replay:${sessionId}:u${++u}` })
      pendingUserText = null
    }
  }
  const flushAsst = () => {
    if (asst && asst.length) {
      cards.push({ kind: 'assistant', sessionId, blocks: asst, meta: {}, id: `replay:${sessionId}:a${++a}` })
    }
    asst = null
    toolIdx.clear()
  }

  for (const upd of updates) {
    switch (upd.sessionUpdate) {
      case 'user_message_chunk':
        flushAsst() // a new user turn ends the previous assistant turn
        pendingUserText = (pendingUserText ?? '') + chunkText(upd.content)
        break
      case 'agent_message_chunk': {
        flushUser()
        if (!asst) asst = []
        const text = chunkText(upd.content)
        const last = asst[asst.length - 1]
        if (last && last.type === 'text') last.text += text
        else asst.push({ type: 'text', text })
        break
      }
      case 'tool_call': {
        flushUser()
        if (!upd.toolCallId) break
        if (!asst) asst = []
        toolIdx.set(upd.toolCallId, asst.length)
        asst.push({ type: 'tool', tool: upd.title ?? 'tool', args: chunkText(upd.content), status: mapStatus(upd.status) })
        break
      }
      case 'tool_call_update': {
        if (!upd.toolCallId || !asst) break
        const i = toolIdx.get(upd.toolCallId)
        const block = i != null ? asst[i] : undefined
        if (block && block.type === 'tool') {
          block.status = mapStatus(upd.status)
          const t = chunkText(upd.content)
          if (t) block.args = t
        }
        break
      }
      // agent_thought_chunk and other updates are intentionally ignored.
    }
  }
  flushUser()
  flushAsst()
  return cards
}
