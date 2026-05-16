<script lang="ts">
  import { api } from '../api/client.js'

  export let sessionId: string
  let text = ''
  let sending = false

  async function send() {
    if (!text.trim() || sending) return
    sending = true
    try {
      await api.sendMessage({ sessionId, text: text.trim() })
      text = ''
    } finally {
      sending = false
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  }
</script>

<div class="composer">
  <textarea
    bind:value={text}
    on:keydown={onKeydown}
    placeholder="Type a message…"
    rows={1}
  />
  <button on:click={send} disabled={sending || !text.trim()}>
    {sending ? '…' : 'Send'}
  </button>
</div>

<style>
  .composer {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid #222;
    background: #0a0a0a;
  }
  textarea {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 10px;
    padding: 10px 12px;
    color: #eee;
    font: inherit;
    resize: none;
    min-height: 40px;
    max-height: 120px;
  }
  button {
    align-self: flex-end;
    padding: 10px 18px;
    border-radius: 10px;
    border: none;
    background: #2563eb;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
