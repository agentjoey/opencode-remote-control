<script lang="ts">
  import type { ToolCall } from '../api/types.js'

  export let tools: ToolCall[]
  let expanded = false

  $: running = tools.filter((t) => t.status === 'running').length
  $: done = tools.filter((t) => t.status === 'done').length
  $: error = tools.filter((t) => t.status === 'error').length
</script>

{#if tools.length > 0}
  <button class="tools-toggle" on:click={() => (expanded = !expanded)}>
    ▸ {tools.length} tool calls
    {#if running > 0}({running} running){/if}
    {#if done > 0}✓ {done}{/if}
    {#if error > 0}✗ {error}{/if}
  </button>

  {#if expanded}
    <ul class="tool-list">
      {#each tools as t}
        <li class={t.status}>
          <span class="icon">
            {t.status === 'done' ? '✓' : t.status === 'error' ? '✗' : '…'}
          </span>
          {t.tool}{#if t.args} · {t.args}{/if}
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .tools-toggle {
    background: #1f1f1f;
    border: 1px solid #333;
    color: #aaa;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.85em;
    cursor: pointer;
    margin-bottom: 6px;
  }
  .tool-list {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
    font-size: 0.85em;
  }
  .tool-list li {
    padding: 2px 0;
    color: #ccc;
  }
  .tool-list li.done { color: #4ade80; }
  .tool-list li.error { color: #f87171; }
  .icon { display: inline-block; width: 1.2em; }
</style>
