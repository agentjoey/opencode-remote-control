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
  const glyph = { done: '✓', running: '◆', pending: '○' } as const
</script>
<div class="task">
  <div class="hd"><span class="label">Task</span>{#if s.total}<span class="label">{s.done}/{s.total}</span>{/if}</div>
  {#if s.total}<div class="bar"><div class="fill" style="width:{Math.round((s.done / s.total) * 100)}%"></div></div>{/if}
  <div class="items">
    {#each s.items as it}
      <div class="it {it.status}">
        <span class="ic">{glyph[it.status]}</span>
        <span class="tx">{it.text}</span>
      </div>
    {/each}
    {#if s.total === 0}<div class="label">No tasks</div>{/if}
  </div>
</div>
<style>
  .task { flex: 1; overflow: auto; padding: 11px 12px; }
  .hd { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .bar { height: 5px; background: var(--bg-input); border-radius: 3px; overflow: hidden; margin-bottom: 9px; }
  .fill { height: 100%; background: var(--accent); transition: width .3s ease; }
  .items { display: flex; flex-direction: column; gap: 6px; font-size: 11.5px; }
  .it { display: flex; align-items: baseline; gap: 7px; line-height: 1.45; }
  .ic { flex-shrink: 0; width: 1em; text-align: center; }
  /* done: green check + muted struck-through text */
  .it.done .ic { color: var(--ok); }
  .it.done .tx { color: var(--text-3); text-decoration: line-through; text-decoration-color: var(--border); }
  /* running: pulsing emerald marker + bright bold text */
  .it.running .ic { color: var(--accent); animation: blink 1.1s ease-in-out infinite; }
  .it.running .tx { color: var(--text); font-weight: 600; }
  /* pending: hollow ring + muted text */
  .it.pending .ic { color: var(--text-3); }
  .it.pending .tx { color: var(--text-2); }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
