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
</script>

<div class="card assistant">
  <ToolCallList {tools} />
  <MarkdownView src={text} />
  {#if card.meta.cost !== undefined}
    <div class="meta">
      💰 ${card.meta.cost.toFixed(3)}
      {#if card.meta.tokens}
        ↑{fmtK(card.meta.tokens.input)} ↓{fmtK(card.meta.tokens.output)}
      {/if}
      {card.meta.agent ?? ''}
      {card.meta.model ?? ''}
    </div>
  {/if}
</div>

<style>
  .card {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 12px;
    margin: 6px 0;
    line-height: 1.4;
    background: #1f1f1f;
    color: #ccc;
    align-self: flex-start;
  }
  .meta {
    font-size: 0.8em;
    color: #888;
    margin-top: 8px;
    border-top: 1px solid #333;
    padding-top: 6px;
  }
</style>
