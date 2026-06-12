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
  <div class="ttl"><span class="ico" aria-hidden="true">⚠</span> {card.title}</div>
  <pre class="args mono">{JSON.stringify(card.args, null, 2)}</pre>
  {#if done}
    <div class="done" class:err={done === 'error'}>{done === 'error' ? 'failed' : done}</div>
  {:else}
    <div class="acts">
      <button class="a allow" on:click={() => decide('once')}>Allow</button>
      <button class="a always" on:click={() => decide('always')}>Always</button>
      <button class="a rej" on:click={() => decide('reject')}>Reject</button>
    </div>
  {/if}
</div>
<style>
  .appr {
    align-self: flex-start;
    max-width: 80%;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    margin: 4px 0;
  }
  .ttl {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 6px;
  }
  .ico { color: var(--warn); }
  .args {
    background: var(--bg);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-2);
    overflow-x: auto;
    margin: 0 0 8px;
  }
  .acts { display: flex; gap: 6px; }
  .a {
    flex: 1;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-input);
    color: var(--text-2);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: background .15s ease, border-color .15s ease, color .15s ease;
  }
  .a:hover { border-color: var(--text-3); color: var(--text); }
  .a.allow {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .a.always {
    background: var(--hl-purple);
    border-color: var(--hl-purple);
    color: var(--bg);
  }
  .a.rej {
    background: var(--err);
    border-color: var(--err);
    color: var(--bg);
  }
  .a.allow:hover, .a.always:hover, .a.rej:hover { opacity: .88; }
  .done {
    font-size: 11px;
    color: var(--text-3);
    text-transform: capitalize;
  }
  .done.err { color: var(--err); }
</style>
