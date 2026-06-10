<!-- src/lib/components/SessionRail.svelte -->
<script lang="ts">
  import SessionList from './SessionList.svelte'
  export let activeId: string | undefined = undefined
  let expanded = false
</script>

<div class="rail" class:expanded>
  <button class="toggle" title="Sessions" on:click={() => (expanded = !expanded)}>☰</button>
  {#if expanded}
    <div class="list"><SessionList {activeId} /></div>
  {/if}
</div>

<style>
  .rail { display: flex; height: 100%; border-right: 1px solid var(--border-2); }
  .toggle { width: 38px; background: transparent; border: none; color: var(--text-3); font-size: 16px; cursor: pointer; padding-top: 10px; align-self: flex-start; }
  .list { width: 220px; border-left: 1px solid var(--border-2); overflow-y: auto; }
</style>
