<!-- src/lib/components/CardApproval.svelte -->
<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'
  import { api } from '../api/client.js'
  export let card: ExtractStructuredCard<'approval'>
  let done = ''
  async function decide(decision: 'once' | 'always' | 'reject') {
    try { await api.approve(card.sessionId, card.requestId, decision); done = decision } catch { done = 'error' }
  }
</script>
<div class="appr">
  <div class="ttl">⚠ {card.title}</div>
  <pre class="args mono">{JSON.stringify(card.args, null, 2)}</pre>
  {#if done}
    <div class="label">{done === 'error' ? 'failed' : done}</div>
  {:else}
    <div class="acts">
      <button class="a once" on:click={() => decide('once')}>✅ Once</button>
      <button class="a" on:click={() => decide('always')}>🔓 Always</button>
      <button class="a rej" on:click={() => decide('reject')}>❌ Reject</button>
    </div>
  {/if}
</div>
<style>
  .appr { align-self: flex-start; max-width: 85%; background: var(--bg-elev); border: 1px solid var(--warn); border-radius: var(--radius); padding: 10px 12px; margin: 6px 0; }
  .ttl { color: var(--warn); font-weight: 600; margin-bottom: 6px; }
  .args { background: var(--bg); border-radius: var(--radius-sm); padding: 8px; font-size: 11px; overflow-x: auto; margin: 0 0 10px; }
  .acts { display: flex; gap: 6px; }
  .a { flex: 1; padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-input); color: var(--text); cursor: pointer; font-size: 12px; }
  .a.once { border-color: var(--accent); } .a.rej { border-color: #7f1d1d; color: #fca5a5; }
</style>
