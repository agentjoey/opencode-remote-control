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

<div class="card streaming">
  <ToolCallList {tools} />
  {#if text}<div class="text"><MarkdownView src={text} throttle /></div>{/if}
  <button class="stop" on:click={() => api.abort(card.sessionId)}>■ stop</button>
</div>

<style>
  .card {
    align-self: stretch;
    width: 100%;
    padding: 4px 2px 8px;
    margin: 6px 0 18px;
    border-left: 2px solid var(--accent);
    padding-left: 14px;
  }
  .text { color: var(--text); font-size: 15px; line-height: 1.7; }
  .stop {
    margin-top: 10px;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-2);
    border-radius: var(--radius-sm);
    padding: 3px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
  }
  .stop:hover { border-color: var(--err); color: var(--err); }
</style>
