<script lang="ts">
  import { api } from '../api/client.js'
  import { connection } from '../stores/connection.js'
  import { upsertCard } from '../stores/sessions.js'
  import { can, backendName } from '../stores/capabilities.js'
  import AgentModelChip from './AgentModelChip.svelte'
  import SessionControls from './SessionControls.svelte'

  export let sessionId: string

  let text = ''
  let sending = false
  let error = ''
  let focused = false
  let textarea: HTMLTextAreaElement
  let fileInput: HTMLInputElement
  let pendingImages: Array<{ data: string; mimeType: string; preview: string }> = []

  function newClientId(): string {
    return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  function readImageFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      const meta = result.slice(0, comma)
      const data = result.slice(comma + 1)
      const mimeType = meta.match(/data:(.*?);/)?.[1] ?? file.type
      pendingImages = [...pendingImages, { data, mimeType, preview: result }]
    }
    reader.readAsDataURL(file)
  }

  function onFilesSelected(e: Event) {
    const input = e.target as HTMLInputElement
    if (!input.files) return
    for (const file of input.files) readImageFile(file)
    input.value = ''
  }

  function onPaste(e: ClipboardEvent) {
    if (!$can('imageInput') || !e.clipboardData) return
    const imageItems = [...e.clipboardData.items].filter((i) => i.type.startsWith('image/'))
    if (!imageItems.length) return
    e.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (file) readImageFile(file)
    }
  }

  function removeImage(index: number) {
    pendingImages = pendingImages.filter((_, i) => i !== index)
  }

  async function send() {
    const body = text.trim()
    if ((!body && pendingImages.length === 0) || sending) return
    if ($connection !== 'connected') { error = 'Disconnected — reconnecting…'; return }

    const clientId = newClientId()
    const images = pendingImages.map(({ data, mimeType }) => ({ data, mimeType }))
    sending = true
    error = ''
    upsertCard({ kind: 'user', sessionId, text: body, ts: Date.now(), id: `user:${clientId}` })
    text = ''
    const savedImages = [...pendingImages]
    pendingImages = []
    autoGrow()
    try {
      await api.sendMessage({ sessionId, text: body, clientId, ...(images.length ? { images } : {}) })
    } catch (e) {
      error = `Send failed: ${(e as Error).message}`
      text = body
      pendingImages = savedImages
    } finally {
      sending = false
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey) return
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    send()
  }

  function autoGrow() {
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px'
  }
</script>

<div class="composer">
  <div class="dock">
    {#if error}
      <div class="error" role="alert">{error}</div>
    {/if}
    <div class="box" class:focused>
      {#if pendingImages.length > 0}
        <div class="thumbnails">
          {#each pendingImages as img, i}
            <div class="thumb">
              <img src={img.preview} alt="attachment" />
              <button class="remove" on:click={() => removeImage(i)} aria-label="Remove image">×</button>
            </div>
          {/each}
        </div>
      {/if}
      <textarea
        bind:this={textarea}
        bind:value={text}
        on:keydown={onKeydown}
        on:input={autoGrow}
        on:paste={onPaste}
        on:focus={() => (focused = true)}
        on:blur={() => (focused = false)}
        placeholder={$connection === 'connected' ? `Message ${$backendName}…  (Enter 发送, Shift+Enter 换行)` : 'Disconnected…'}
        rows={1}
      ></textarea>
      <div class="controls">
        {#if $can('imageInput')}
          <button class="attach" on:click={() => fileInput.click()} aria-label="Attach image">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </button>
          <input type="file" accept="image/*" multiple bind:this={fileInput} on:change={onFilesSelected} style="display:none" />
        {/if}
        {#if $can('catalog')}<AgentModelChip />{/if}
        {#if $can('sessionControls')}<SessionControls {sessionId} />{/if}
        <span class="spacer"></span>
        <button class="send" on:click={send} aria-label="Send"
                disabled={sending || (!text.trim() && pendingImages.length === 0) || $connection !== 'connected'}>
          {#if sending}…{:else}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .composer {
    background: var(--bg);
    padding: 0 24px 22px;
  }
  /* Phones: tighter side padding. Clear the home indicator with the FULL
     safe-area inset (≈34px in a standalone PWA, 0 in a browser tab) plus a little
     breathing room, so the controls never sit under the home bar. */
  @media (max-width: 820px) {
    /* Floating input box: 12px side margins. The bottom padding clears the home
       indicator AT REST, but telescopes away as the composer lifts off the bottom
       (--kb > 0) — otherwise that ~44px of home-indicator space becomes dead gap
       between the box and the keyboard (the indicator is hidden behind it anyway). */
    .composer {
      padding: 0 12px;
      padding-bottom: max(8px, calc(env(safe-area-inset-bottom, 0px) + 10px - var(--kb, 0px)));
    }
  }
  .dock {
    max-width: 760px;
    margin: 0 auto;
  }
  .error {
    color: var(--err);
    font-size: 0.8em;
    margin: 0 0 8px;
    font-family: var(--font-mono);
  }
  /* one rounded surface holding the input + its controls (claude.ai style) */
  .box {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, .28);
    transition: border-color .15s ease;
  }
  .box.focused { border-color: var(--accent); }
  textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    background: transparent;
    border: none;
    padding: 4px 4px 2px;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 16px; /* ≥16px so iOS never auto-zooms the page on focus */
    line-height: 1.5;
    resize: none;
    min-height: 24px;
    max-height: 200px;
    overflow-y: auto;
  }
  textarea:focus { outline: none; }
  textarea::placeholder { color: var(--text-3); }
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .spacer { flex: 1; }
  .send {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: var(--accent);
    color: var(--accent-ink);
    cursor: pointer;
    transition: opacity .15s ease, transform .1s ease;
  }
  .send:not(:disabled):hover { transform: scale(1.06); }
  .send:disabled {
    background: var(--border);
    color: var(--text-3);
    cursor: not-allowed;
  }
  .thumbnails {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .thumb {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border);
    flex-shrink: 0;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .remove:hover { background: rgba(0, 0, 0, 0.8); }
  .attach {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    padding: 0;
  }
  .attach:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
</style>
