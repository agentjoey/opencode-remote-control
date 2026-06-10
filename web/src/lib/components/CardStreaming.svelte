<script lang="ts">
  import type { ExtractStructuredCard, ToolBlock, TextBlock } from '../api/types.js'
  import MarkdownView from './MarkdownView.svelte'
  import ToolCallList from './ToolCallList.svelte'
  import { api } from '../api/client.js'

  export let card: ExtractStructuredCard<'streaming'>

  $: tools = card.blocks
    .filter((b): b is ToolBlock => b.type === 'tool')
    .map(b => ({ tool: b.tool, args: b.args, status: b.status }))
  $: text = card.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text).join('')
</script>

<div class="assistant streaming">
  <ToolCallList {tools} />
  {#if text}<div class="text"><MarkdownView src={text} throttle /></div>{/if}
  <button class="stop" on:click={() => api.abort(card.sessionId)}>■ stop</button>
</div>

<style>
  .assistant {
    border-left: 2px solid var(--accent);
    padding: 2px 0 8px 14px;
    margin: 2px 0 10px;
  }
  .text { color: var(--text-2); font-size: 13px; line-height: 1.6; }
  .stop {
    margin-top: 8px;
    background: transparent;
    border: 1px solid #7f3a3a;
    color: var(--err);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
  }
</style>
