<script lang="ts">
  import { api } from '../api/client.js'
  import { connection } from '../stores/connection.js'
  import { upsertCard } from '../stores/sessions.js'
  import AgentModelChip from './AgentModelChip.svelte'

  export let sessionId: string
  /** Send on plain Enter (Shift+Enter = newline). Ctrl/Cmd+Enter always sends. */
  export let enterToSend = true

  let text = ''
  let sending = false
  let error = ''
  let textarea: HTMLTextAreaElement

  function newClientId(): string {
    return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    if ($connection !== 'connected') { error = 'Disconnected — reconnecting…'; return }

    const clientId = newClientId()
    sending = true
    error = ''
    // Optimistic echo: insert a local user card now; the server's user card
    // carries the same id (`user:<clientId>`) and upserts it in place.
    upsertCard({ kind: 'user', sessionId, text: body, ts: Date.now(), id: `user:${clientId}` })
    text = ''
    autoGrow()
    try {
      await api.sendMessage({ sessionId, text: body, clientId })
    } catch (e) {
      error = `Send failed: ${(e as Error).message}`
      text = body // restore so the user can retry
    } finally {
      sending = false
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); return }
    if (enterToSend && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function autoGrow() {
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px'
  }
</script>

<div class="composer">
  {#if error}
    <div class="error" role="alert">{error}</div>
  {/if}
  <div class="row">
    <AgentModelChip />
    <textarea
      bind:this={textarea}
      bind:value={text}
      on:keydown={onKeydown}
      on:input={autoGrow}
      placeholder={$connection === 'connected' ? 'Type a message…' : 'Disconnected…'}
      rows={1}
    ></textarea>
    <button on:click={send} disabled={sending || !text.trim() || $connection !== 'connected'}>
      {sending ? '…' : 'Send'}
    </button>
  </div>
</div>

<style>
  .composer {
    border-top: 1px solid var(--border);
    background: var(--bg);
    padding: 12px 16px 18px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    max-width: 880px;
    margin: 0 auto;
  }
  .error {
    color: var(--err);
    font-size: 0.8em;
    margin: 0 auto 8px;
    max-width: 880px;
    font-family: var(--font-mono);
  }
  textarea {
    flex: 1;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.5;
    resize: none;
    min-height: 42px;
    max-height: 160px;
    overflow-y: auto;
  }
  textarea:focus { outline: none; border-color: var(--accent); }
  button {
    align-self: flex-end;
    padding: 10px 18px;
    border-radius: var(--radius);
    border: none;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
