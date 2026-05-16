chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'oprc-send-selection',
    title: 'Send to opencode',
    contexts: ['selection', 'link'],
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'oprc-send-selection') return
  if (!tab?.id) return
  const payload = formatSelection(info, tab)
  await chrome.sidePanel.open({ tabId: tab.id })
  chrome.runtime.sendMessage({ type: 'inject-prompt', payload })
})

function formatSelection(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab,
): string {
  const page = tab.url ?? ''
  if (info.linkUrl) {
    return `[Link] ${info.linkUrl}`
  }
  if (info.selectionText) {
    return `[Page] ${page}\n[Selection]\n${info.selectionText}`
  }
  return `[Page] ${page}`
}
