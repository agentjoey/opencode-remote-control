<script lang="ts">
  import { tick } from 'svelte'
  import { api } from '../api/client.js'
  import { connection } from '../stores/connection.js'
  import { upsertCard } from '../stores/sessions.js'
  import { can, backendName } from '../stores/capabilities.js'
  import { paletteOpen } from '../stores/palette.js'
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

  let mentionResults: string[] = []
  let mentionActive = 0
  let mentionStart = 0
  let mentionTimer: ReturnType<typeof setTimeout> | undefined

  $: hasText = text.trim().length > 0

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

  function detectMention(): { token: string; start: number } | null {
    if (!textarea) return null
    const pos = textarea.selectionStart
    const before = text.slice(0, pos)
    const m = before.match(/(^|[\s])@([^\s]*)$/)
    if (!m) return null
    return { token: m[2], start: pos - m[2].length - 1 }
  }

  function updateMention() {
    const found = detectMention()
    if (!found) {
      mentionResults = []
      clearTimeout(mentionTimer)
      return
    }
    mentionStart = found.start
    mentionActive = 0
    clearTimeout(mentionTimer)
    const q = found.token
    mentionTimer = setTimeout(async () => {
      try {
        mentionResults = await api.files(sessionId, q)
      } catch {
        mentionResults = []
      }
    }, 150)
  }

  function selectMention(path: string) {
    const caretEnd = textarea.selectionStart
    const before = text.slice(0, mentionStart)
    const after = text.slice(caretEnd)
    const insert = `@${path} `
    text = before + insert + after
    mentionResults = []
    tick().then(() => {
      const pos = before.length + insert.length
      textarea.selectionStart = textarea.selectionEnd = pos
      textarea.focus()
      autoGrow()
    })
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
    if (mentionResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mentionActive = Math.min(mentionActive + 1, mentionResults.length - 1); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); mentionActive = Math.max(mentionActive - 1, 0); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionResults[mentionActive]); return }
      if (e.key === 'Escape') { e.preventDefault(); mentionResults = []; return }
    }
    if (e.key !== 'Enter' || e.shiftKey) return
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    send()
  }

  function autoGrow() {
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px'
  }
</script>

<div class="composer">
  <div class="dock">
    {#if error}
      <div class="error" role="alert">{error}</div>
    {/if}
    <div class="box" class:focused class:has-text={hasText}>
      {#if mentionResults.length > 0}
        <div class="mention-dropdown" role="listbox">
          {#each mentionResults as path, i}
            <button
              class="mention-row"
              class:active={i === mentionActive}
              role="option"
              aria-selected={i === mentionActive}
              on:mousedown|preventDefault={() => selectMention(path)}
            >{path}</button>
          {/each}
        </div>
      {/if}
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
        on:input={() => { autoGrow(); updateMention() }}
        on:paste={onPaste}
        on:focus={() => (focused = true)}
        on:blur={() => (focused = false)}
        on:click={updateMention}
        placeholder={$connection === 'connected' ? `Message ${$backendName}…` : 'Disconnected…'}
        rows={1}
      ></textarea>
      <div class="footer">
        {#if $can('imageInput')}
          <button class="attach" on:click={() => fileInput.click()} aria-label="Attach image">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </button>
          <input type="file" accept="image/*" multiple bind:this={fileInput} on:change={onFilesSelected} style="display:none" />
        {/if}
        {#if $can('catalog')}<AgentModelChip />{/if}
        {#if $can('sessionControls')}<SessionControls {sessionId} />{/if}
        <button class="hint command" on:click={() => paletteOpen.set(true)}>/ for commands</button>
        <span class="spacer"></span>
        <span class="hint send-hint">↵ send · ⇧↵ newline</span>
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
    padding: 6px 24px 18px;
  }
  @media (max-width: 820px) {
    .composer {
      padding: 0 12px;
      padding-bottom: max(8px, calc(env(safe-area-inset-bottom, 0px) + 10px - var(--kb, 0px)));
    }
    /* Compact pill on mobile (design = "pill + round send") instead of the taller
       desktop box, so a focused input doesn't read as a bulky floating block. */
    .box { padding: 7px 8px 7px 14px; border-radius: 22px; }
    .footer { margin-top: 4px; }
  }
  .dock {
    max-width: 780px;
    margin: 0 auto;
  }
  .error {
    color: var(--err);
    font-size: 0.8em;
    margin: 0 0 8px;
    font-family: var(--font-mono);
  }
  .box {
    position: relative;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 12px 14px 8px;
    box-shadow: var(--shadow-composer);
    transition: border-color .15s ease;
  }
  .box.focused,
  .box.has-text { border-color: var(--accent); }
  textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    background: transparent;
    border: none;
    padding: 2px 4px;
    color: var(--text);
    font-family: var(--font-sans);
    /* 16px (not 15) is REQUIRED: iOS Safari auto-zooms the page on focus for inputs
       <16px and doesn't reset on blur — that was the focus zoom + width overflow +
       post-blur clipped box. Keep ≥16px. */
    font-size: 16px;
    line-height: 1.5;
    resize: none;
    min-height: 24px;
    max-height: 140px;
    overflow-y: auto;
  }
  textarea:focus { outline: none; }
  textarea::placeholder { color: var(--text-4); }
  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    min-width: 0;
  }
  .spacer { flex: 1; min-width: 8px; }
  /* Hide the keyboard-hint texts when the composer gets narrow so the chips +
     send button never overflow the box (and the page). */
  @media (max-width: 720px) {
    .send-hint, .hint.command { display: none; }
  }
  .hint {
    background: transparent;
    border: none;
    color: var(--text-4);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: nowrap;
    padding: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint.command {
    cursor: pointer;
    transition: color .15s ease;
  }
  .hint.command:hover { color: var(--text-2); }
  .send {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 33px;
    height: 33px;
    border-radius: 50%;
    border: none;
    background: var(--accent);
    color: var(--accent-ink);
    cursor: pointer;
    transition: opacity .15s ease, transform .1s ease;
    flex-shrink: 0;
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
    color: var(--text-3);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .attach:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .mention-dropdown {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    max-height: 180px;
    overflow-y: auto;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    margin-bottom: 4px;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);
    padding: 4px;
    z-index: 10;
  }
  .mention-row {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.85em;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mention-row.active, .mention-row:hover {
    background: var(--accent-2);
  }
</style>
