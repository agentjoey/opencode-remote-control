<!-- src/lib/components/inspector/TaskPanel.svelte -->
<script lang="ts">
  import { api } from '$lib/api/client.js'
  import { summarizeTodos, type TodoSummary } from '$lib/inspector/summarizeTodos.js'

  export let sessionId: string | undefined = undefined
  export let tick = 0

  let s: TodoSummary = { total: 0, done: 0, items: [] }
  let toggled = new Set<number>()
  let lastSessionId: string | undefined

  async function load(id?: string) {
    if (!id) {
      s = { total: 0, done: 0, items: [] }
      toggled = new Set()
      return
    }
    if (id !== lastSessionId) {
      lastSessionId = id
      toggled = new Set()
    }
    try {
      s = summarizeTodos(await api.todo(id))
    } catch {
      /* keep last valid summary on transient failures */
    }
  }

  $: load(sessionId), tick

  $: effItems = s.items.map((it, i) => ({
    ...it,
    status: toggled.has(i) ? (it.status === 'done' ? 'pending' : 'done') : it.status,
  }))
  $: effDone = effItems.filter((it) => it.status === 'done').length
  $: pct = s.total ? Math.round((effDone / s.total) * 100) : 0

  function toggle(i: number) {
    if (toggled.has(i)) toggled.delete(i)
    else toggled.add(i)
    toggled = toggled
  }
</script>

<div class="task">
  <div class="hd">
    <span class="section-label">Tasks</span>
    {#if s.total}<span class="meta">{effDone}/{s.total}</span>{/if}
  </div>
  {#if s.total}
    <div class="bar"><div class="fill" style="width:{pct}%"></div></div>
  {/if}
  <div class="items">
    {#each effItems as it, i (it.text + '-' + i)}
      <button type="button" class="row {it.status}" on:click={() => toggle(i)}>
        <span class="box">
          <span class="dot"></span>
          <span class="check">✓</span>
        </span>
        <span class="tx">{it.text}</span>
      </button>
    {/each}
    {#if s.total === 0}<div class="section-label">No tasks</div>{/if}
  </div>
</div>

<style>
  .task {
    flex: 1;
    overflow: auto;
    padding: 14px 16px;
  }
  .hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .section-label {
    text-transform: uppercase;
    letter-spacing: .16em;
    color: var(--text-3);
    font-size: 10px;
  }
  .meta {
    font-family: var(--font-mono);
    color: var(--text-2);
    font-size: 11px;
  }
  .bar {
    height: 4px;
    background: var(--bg-input);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 10px;
  }
  .fill {
    height: 100%;
    background: var(--user-bubble);
    transition: width .3s ease;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 3px 0;
    margin: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover .tx {
    color: var(--text);
  }
  .row:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
    border-radius: 4px;
  }
  .box {
    flex-shrink: 0;
    width: 15px;
    height: 15px;
    margin-top: 1px;
    border-radius: 3px;
    display: grid;
    place-items: center;
    position: relative;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    animation: ocrc-pulse 1.2s ease-in-out infinite;
    display: none;
  }
  .check {
    font-size: 11px;
    line-height: 1;
    display: none;
  }
  .tx {
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-2);
  }

  /* done: filled accent box + check ink + struck-through muted label */
  .row.done .box {
    background: var(--accent);
  }
  .row.done .check {
    display: block;
    color: var(--accent-ink);
  }
  .row.done .tx {
    color: var(--text-3);
    text-decoration: line-through;
    text-decoration-color: var(--border);
  }

  /* running: accent-outlined box + pulsing inner dot + bright label */
  .row.running .box {
    border: 1.5px solid var(--accent);
  }
  .row.running .dot {
    display: block;
  }
  .row.running .tx {
    color: var(--text);
    font-weight: 500;
  }

  /* pending: --border outline + muted label */
  .row.pending .box {
    border: 1.5px solid var(--border);
  }
</style>
