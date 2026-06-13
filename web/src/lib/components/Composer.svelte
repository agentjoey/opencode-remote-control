<script lang="ts">
  import { api } from '../api/client.js'
  import { connection } from '../stores/connection.js'
  import { upsertCard } from '../stores/sessions.js'
  import AgentModelChip from './AgentModelChip.svelte'

  export let sessionId: string

  let text = ''
  let sending = false
  let error = ''
  let focused = false
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
    // Enter sends; Shift+Enter inserts a newline. Skip while an IME is
    // composing (e.g. Chinese input) — Enter there commits the candidate.
    if (e.key !== 'Enter' || e.shiftKey) return
    if (e.isComposing || e.keyCode === 229) return // IME composition in progress
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
      <textarea
        bind:this={textarea}
        bind:value={text}
        on:keydown={onKeydown}
        on:input={autoGrow}
        on:focus={() => (focused = true)}
        on:blur={() => (focused = false)}
        placeholder={$connection === 'connected' ? 'Message opencode…  (Enter 发送, Shift+Enter 换行)' : 'Disconnected…'}
        rows={1}
      ></textarea>
      <div class="controls">
        <AgentModelChip />
        <span class="spacer"></span>
        <button class="send" on:click={send} aria-label="Send"
                disabled={sending || !text.trim() || $connection !== 'connected'}>
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
  /* Phones: tighter side padding + clear the home-bar (max, not additive). */
  @media (max-width: 820px) {
    .composer {
      padding: 0 12px;
      padding-bottom: max(10px, env(safe-area-inset-bottom, 0px));
    }
    /* ≥16px so iOS doesn't auto-zoom the page when the field is focused. */
    textarea { font-size: 16px; }
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
    font-size: 14px;
    line-height: 1.55;
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
</style>
