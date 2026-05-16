import type { OpencodeClient } from '@opencode-ai/sdk'

// Extract the body type from session.prompt parameter using TypeScript inference.
// This avoids coupling to SDK internal paths that may change between versions.
type PromptBody = Parameters<OpencodeClient['session']['prompt']>[0] extends { body?: infer B }
  ? B
  : never

export interface SubmitOptions {
  text: string
  sessionId: string
  agent?: string
  model?: { providerID: string; modelID: string }
  signal?: AbortSignal
}

export async function submitPrompt(
  client: OpencodeClient,
  opts: SubmitOptions,
): Promise<void> {
  const body = {
    parts: [{ type: 'text' as const, text: opts.text }],
    ...(opts.agent ? { agent: opts.agent } : {}),
    ...(opts.model ? { model: opts.model } : {}),
  } as PromptBody

  await client.session.prompt({
    path: { id: opts.sessionId },
    body,
    signal: opts.signal,
  })
}
