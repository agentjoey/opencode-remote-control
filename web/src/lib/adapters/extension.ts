export async function getBotUrl(): Promise<string> {
  const { botUrl } = await chrome.storage.local.get('botUrl')
  if (!botUrl) throw new Error('Bot URL not configured')
  return botUrl as string
}
