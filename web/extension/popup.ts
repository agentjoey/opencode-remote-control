const input = document.getElementById('url') as HTMLInputElement
const btn = document.getElementById('save') as HTMLButtonElement
const status = document.getElementById('status') as HTMLDivElement

chrome.storage.local.get('botUrl').then(({ botUrl }) => {
  if (botUrl) input.value = botUrl as string
})

btn.addEventListener('click', async () => {
  const url = input.value.trim().replace(/\/$/, '')
  if (!url) {
    status.textContent = 'Please enter a URL'
    status.className = 'err'
    return
  }
  try {
    new URL(url)
  } catch {
    status.textContent = 'Invalid URL'
    status.className = 'err'
    return
  }
  await chrome.storage.local.set({ botUrl: url })
  status.textContent = 'Saved! Open the side panel to connect.'
  status.className = 'ok'
})
