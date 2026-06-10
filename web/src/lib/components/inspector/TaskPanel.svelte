<!-- src/lib/components/inspector/TaskPanel.svelte -->
<script lang="ts">
  import { api } from '$lib/api/client.js'
  import { summarizeTodos, type TodoSummary } from '$lib/inspector/summarizeTodos.js'
  export let sessionId: string | undefined = undefined
  export let tick = 0
  let s: TodoSummary = { total: 0, done: 0, items: [] }
  async function load(id?: string) {
    if (!id) { s = { total: 0, done: 0, items: [] }; return }
    try { s = summarizeTodos(await api.todo(id)) } catch { /* keep last */ }
  }
  $: load(sessionId), tick // refetch on session change or activity tick
  const glyph = { done: '✓', running: '▸', pending: '○' } as const
</script>
<div class="task">
  <div class="hd"><span class="label">Task</span>{#if s.total}<span class="label">{s.done}/{s.total}</span>{/if}</div>
  {#if s.total}<div class="bar"><div class="fill" style="width:{Math.round((s.done / s.total) * 100)}%"></div></div>{/if}
  <div class="items">
    {#each s.items as it}
      <div class="it {it.status}">{glyph[it.status]} {it.text}</div>
    {/each}
    {#if s.total === 0}<div class="label">No tasks</div>{/if}
  </div>
</div>
<style>
  .task { flex: 1; overflow: auto; padding: 11px 12px; }
  .hd { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .bar { height: 5px; background: var(--bg-input); border-radius: 3px; overflow: hidden; margin-bottom: 9px; }
  .fill { height: 100%; background: var(--ok); }
  .items { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; }
  .it.done { color: var(--ok); } .it.running { color: var(--warn); } .it.pending { color: var(--text-3); }
</style>
