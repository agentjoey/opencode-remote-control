import type { OpencodeClient } from '@opencode-ai/sdk'

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
  const body: Record<string, unknown> = {
    parts: [{ type: 'text', text: opts.text }],
  }
  if (opts.agent) body.agent = opts.agent
  if (opts.model) body.model = opts.model
  await client.session.prompt({
    path: { id: opts.sessionId },
    body,
    signal: opts.signal,
  } as any)
}
