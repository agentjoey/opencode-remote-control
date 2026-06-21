<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { ExtractStructuredCard, ToolBlock, TextBlock } from '../api/types.js'
  import MarkdownView from './MarkdownView.svelte'
  import ToolCallList from './ToolCallList.svelte'

  export let card: ExtractStructuredCard<'assistant'>
  const dispatch = createEventDispatcher<{ retry: void }>()

  $: tools = card.blocks
    .filter((b): b is ToolBlock => b.type === 'tool')
    .map(b => ({ tool: b.tool, args: b.args, status: b.status }))
  $: text = card.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text).join('')

  function fmtK(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  }
  $: m = card.meta
  $: hasMeta = m.agent || m.model || m.tokens || (m as any).duration != null || m.cost !== undefined

  let copied = false
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  async function copy() {
    if (!text) return
    try { await navigator.clipboard.writeText(text) } catch { return }
    copied = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied = false), 1300)
  }
</script>

<div class="card assistant">
  <ToolCallList {tools} />
  {#if text}<div class="text"><MarkdownView src={text} /></div>{/if}
  {#if hasMeta}
    <div class="meta">
      <div class="chips">
        {#if m.agent}<span class="chip agent mono">{m.agent}</span>{/if}
        {#if m.model}<span class="chip mono">{m.model}</span>{/if}
        {#if m.tokens}<span class="chip mono">↑{fmtK(m.tokens.input)} ↓{fmtK(m.tokens.output)}</span>{/if}
        {#if (m as any).duration != null}<span class="chip mono">{(m as any).duration}s</span>{/if}
        {#if m.cost !== undefined}<span class="chip cost mono">${m.cost.toFixed(3)}</span>{/if}
      </div>
      <div class="actions">
        <button class="icon" class:copied title="Copy" aria-label="Copy" on:click={copy}>
          {#if copied}✓{:else}⧉{/if}
        </button>
        <button class="icon" title="Retry" aria-label="Retry" on:click={() => dispatch('retry')}>
          ↻
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .card {
    align-self: stretch;
    width: 100%;
    padding: 4px 2px 8px;
    margin: 6px 0 18px;
  }
  .text { color: var(--text); }
  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
    padding-top: 2px;
  }
  .chips {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-3);
    background: var(--bg-elev);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-pill);
    padding: 2px 8px;
  }
  .chip.agent {
    color: var(--accent);
    background: var(--accent-2);
    border-color: var(--accent-line);
  }
  .chip.cost { color: var(--warn); }
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: transparent;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    color: var(--text-3);
    font-size: 12px;
    cursor: pointer;
    transition: color .15s ease, border-color .15s ease, background .15s ease;
  }
  .icon:hover { color: var(--text); border-color: var(--border); background: var(--bg-elev); }
  .icon.copied { color: var(--accent); border-color: var(--accent-line); background: var(--accent-2); }
</style>
