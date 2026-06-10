const urlInput = document.getElementById('url') as HTMLInputElement
const cidInput = document.getElementById('cid') as HTMLInputElement
const secretInput = document.getElementById('csecret') as HTMLInputElement
const btn = document.getElementById('save') as HTMLButtonElement
const status = document.getElementById('status') as HTMLDivElement

// A non-empty stored secret is shown as a placeholder, not the real value, so it
// isn't re-displayed in plain form. Saving with the field left untouched keeps
// the existing secret.
const SECRET_KEPT = '••••••••'
let hadSecret = false

chrome.storage.local
  .get(['botUrl', 'cfAccessClientId', 'cfAccessClientSecret'])
  .then(({ botUrl, cfAccessClientId, cfAccessClientSecret }) => {
    if (botUrl) urlInput.value = botUrl as string
    if (cfAccessClientId) cidInput.value = cfAccessClientId as string
    if (cfAccessClientSecret) {
      hadSecret = true
      secretInput.value = SECRET_KEPT
    }
  })

function fail(msg: string) {
  status.textContent = msg
  status.className = 'err'
}

btn.addEventListener('click', async () => {
  const url = urlInput.value.trim().replace(/\/$/, '')
  if (!url) return fail('Please enter a Bot URL')
  try {
    new URL(url)
  } catch {
    return fail('Invalid URL')
  }

  const clientId = cidInput.value.trim()
  const secretRaw = secretInput.value
  // Keep the existing secret if the placeholder is untouched.
  const secret = secretRaw === SECRET_KEPT && hadSecret ? undefined : secretRaw.trim()

  // Either both token fields or neither (a token needs both id and secret).
  const effectiveSecret = secret === undefined ? '__keep__' : secret
  if ((clientId === '') !== (effectiveSecret === '')) {
    return fail('Enter both the Client ID and Secret, or leave both blank')
  }

  const patch: Record<string, unknown> = { botUrl: url, cfAccessClientId: clientId || undefined }
  if (secret !== undefined) patch.cfAccessClientSecret = secret || undefined

  // chrome.storage.set ignores undefined; remove cleared keys explicitly.
  const toRemove: string[] = []
  if (!clientId) toRemove.push('cfAccessClientId')
  if (secret === '') toRemove.push('cfAccessClientSecret')

  await chrome.storage.local.set(
    Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
  )
  if (toRemove.length) await chrome.storage.local.remove(toRemove)

  status.textContent = 'Saved. Open the side panel to connect.'
  status.className = 'ok'
})
