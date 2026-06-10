<script lang="ts">
  import type { ToolCall } from '../api/types.js'

  export let tools: ToolCall[]
  const LIMIT = 12
  let expanded = false

  $: shown = expanded ? tools : tools.slice(0, LIMIT)
  function glyph(s: string) { return s === 'done' ? '✓' : s === 'error' ? '✗' : '·' }
</script>

{#if tools.length > 0}
  <div class="tools">
    {#each shown as t}
      <div class="t {t.status}">
        <span class="g">{glyph(t.status)}</span>
        <span class="name">{t.tool}</span>
        {#if t.args}<span class="args">{t.args}</span>{/if}
      </div>
    {/each}
    {#if tools.length > LIMIT && !expanded}
      <button class="more" on:click={() => (expanded = true)}>… {tools.length - LIMIT} more</button>
    {/if}
  </div>
{/if}

<style>
  .tools {
    font-family: var(--font-mono);
    font-size: 12px;
    margin: 2px 0 6px;
  }
  .t {
    display: flex;
    gap: 8px;
    padding: 1px 0;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .t .g { width: 1em; flex-shrink: 0; }
  .t .name { color: var(--text-2); flex-shrink: 0; }
  .t .args { color: var(--text-3); overflow: hidden; text-overflow: ellipsis; }
  .t.done .g { color: var(--ok); }
  .t.running .g { color: var(--warn); }
  .t.error .g, .t.error .name { color: var(--err); }
  .more { background: transparent; border: none; color: var(--text-3); cursor: pointer; font: inherit; padding: 1px 0; }
</style>
