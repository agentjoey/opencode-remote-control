import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk'

let _client: OpencodeClient | null = null

export function getClient(baseUrl: string): OpencodeClient {
  if (_client) return _client
  _client = createOpencodeClient({ baseUrl })
  return _client
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/global/health`)
    if (!res.ok) return false
    const data = (await res.json()) as { healthy?: boolean }
    return data.healthy === true
  } catch {
    return false
  }
}
