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
  <MarkdownView src={text} throttle />
  <button class="stop" on:click={() => api.abort(card.sessionId)}>Stop</button>
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
  .stop {
    background: #3f1d1d;
    border: 1px solid #7f3a3a;
    color: #f87171;
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 0.8em;
    cursor: pointer;
    margin-top: 6px;
  }
</style>
