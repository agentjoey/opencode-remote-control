<script lang="ts">
  import type { ExtractStructuredCard, ToolBlock, TextBlock } from '../api/types.js'
  import MarkdownView from './MarkdownView.svelte'
  import ToolCallList from './ToolCallList.svelte'

  export let card: ExtractStructuredCard<'streaming'>

  $: tools = card.blocks
    .filter((b): b is ToolBlock => b.type === 'tool')
    .map(b => ({ tool: b.tool, args: b.args, status: b.status }))
  $: text = card.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text).join('')
</script>

<div class="card streaming">
  <ToolCallList {tools} />
  {#if text}<div class="text"><MarkdownView src={text} throttle streaming /></div>{/if}
</div>

<style>
  .card {
    align-self: stretch;
    width: 100%;
    padding: 4px 2px 8px;
    margin: 6px 0 18px;
  }
  /* In-progress streaming reads as muted "thinking"; the finalized answer
     (CardAssistant) renders full-size in normal text. */
  .text { color: var(--text-2); font-size: 13px; line-height: 1.6; }
  .text :global(.md) { font-size: 13px; color: var(--text-2); line-height: 1.6; }
</style>
