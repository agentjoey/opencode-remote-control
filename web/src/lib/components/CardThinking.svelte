<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'
  import { api } from '../api/client.js'

  export let card: ExtractStructuredCard<'thinking'>
</script>

<div class="card thinking">
  ⏳ Working…
  {#if card.showStop}
    <button class="stop" on:click={() => api.abort(card.sessionId)}>Stop</button>
  {/if}
</div>

<style>
  .card {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 12px;
    margin: 6px 0;
    line-height: 1.4;
    background: #1f1f1f;
    color: #ccc;
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .stop {
    background: #3f1d1d;
    border: 1px solid #7f3a3a;
    color: #f87171;
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 0.8em;
    cursor: pointer;
  }
</style>
