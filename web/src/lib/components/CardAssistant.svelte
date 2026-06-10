<script lang="ts">
  import type { ExtractStructuredCard, ToolBlock, TextBlock } from '../api/types.js'
  import MarkdownView from './MarkdownView.svelte'
  import ToolCallList from './ToolCallList.svelte'

  export let card: ExtractStructuredCard<'assistant'>

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
  $: hasMeta = m.cost !== undefined || m.agent || m.model || m.tokens
</script>

<div class="card assistant">
  <ToolCallList {tools} />
  {#if text}<div class="text"><MarkdownView src={text} /></div>{/if}
  {#if hasMeta}
    <div class="meta">
      {#if m.agent}<span>{m.agent}</span>{/if}
      {#if m.model}<span>{m.model}</span>{/if}
      {#if m.tokens}<span>↑{fmtK(m.tokens.input)} ↓{fmtK(m.tokens.output)}</span>{/if}
      {#if m.cost !== undefined}<span>${m.cost.toFixed(3)}</span>{/if}
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
  .text { color: var(--text); font-size: 15px; line-height: 1.7; }
  .meta {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-3);
    margin-top: 12px;
    padding-top: 2px;
  }
</style>
