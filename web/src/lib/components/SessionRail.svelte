<!-- src/lib/components/SessionRail.svelte -->
<script lang="ts">
  import SessionList from './SessionList.svelte'
  export let activeId: string | undefined = undefined
  let expanded = false
</script>

<div class="rail" class:expanded>
  <div class="spine">
    <button class="toggle" class:on={expanded} title="Sessions" aria-label="Toggle sessions"
            on:click={() => (expanded = !expanded)}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>
  </div>
  {#if expanded}
    <div class="panel">
      <div class="phead label">Sessions</div>
      <div class="list"><SessionList {activeId} /></div>
    </div>
  {/if}
</div>

<style>
  .rail { display: flex; height: 100%; border-right: 1px solid var(--border-2); background: var(--bg-panel); }
  .spine { width: 46px; display: flex; justify-content: center; padding-top: 10px; flex-shrink: 0; }
  .toggle {
    width: 32px; height: 32px;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--text-3); cursor: pointer;
    transition: background .12s ease, color .12s ease;
  }
  .toggle:hover { background: var(--bg-elev); color: var(--text); }
  .toggle.on { color: var(--accent); }
  .panel { display: flex; flex-direction: column; width: 240px; border-left: 1px solid var(--border-2); overflow: hidden; }
  .phead { padding: 12px 14px 8px; }
  .list { flex: 1; overflow-y: auto; }
</style>
