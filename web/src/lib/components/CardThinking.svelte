<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'
  import { api } from '../api/client.js'

  export let card: ExtractStructuredCard<'thinking'>
</script>

<div class="thinking-row">
  <span class="toggle mono">
    <span class="caret" aria-hidden="true">▸</span>
    reasoning
  </span>
  {#if card.showStop}
    <button class="stop" on:click={() => api.abort(card.sessionId)}>Stop</button>
  {/if}
</div>

<style>
  .thinking-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 2px 0 8px;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--hl-purple);
    user-select: none;
  }
  .caret {
    display: inline-block;
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .stop {
    background: transparent;
    border: 1px solid var(--border-2);
    color: var(--text-3);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    cursor: pointer;
    transition: color .15s ease, border-color .15s ease;
  }
  .stop:hover { color: var(--err); border-color: var(--err); }
</style>
