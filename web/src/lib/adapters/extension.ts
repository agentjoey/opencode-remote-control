export interface ExtensionConfig {
  botUrl: string
  /** CF Access service token (B5 option A). Optional — omitted falls back to cookie. */
  cfAccessClientId?: string
  cfAccessClientSecret?: string
}

export async function getBotUrl(): Promise<string> {
  const { botUrl } = await chrome.storage.local.get('botUrl')
  if (!botUrl) throw new Error('Bot URL not configured')
  return botUrl as string
}

export async function getExtensionConfig(): Promise<ExtensionConfig> {
  const { botUrl, cfAccessClientId, cfAccessClientSecret } = await chrome.storage.local.get([
    'botUrl',
    'cfAccessClientId',
    'cfAccessClientSecret',
  ])
  if (!botUrl) throw new Error('Bot URL not configured')
  return { botUrl, cfAccessClientId, cfAccessClientSecret }
}

/** CF Access service-token headers for cross-origin REST, or {} when unset. */
export function serviceTokenHeaders(cfg: ExtensionConfig): Record<string, string> {
  if (cfg.cfAccessClientId && cfg.cfAccessClientSecret) {
    return {
      'CF-Access-Client-Id': cfg.cfAccessClientId,
      'CF-Access-Client-Secret': cfg.cfAccessClientSecret,
    }
  }
  return {}
}
