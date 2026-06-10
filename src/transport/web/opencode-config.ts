/** Best-effort GET of an opencode raw-config endpoint. Returns {} on any failure. */
export async function fetchOpencodeConfig(baseUrl: string, path: string): Promise<any> {
  if (!baseUrl) return {}
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return {}
    return await res.json()
  } catch {
    return {}
  }
}
