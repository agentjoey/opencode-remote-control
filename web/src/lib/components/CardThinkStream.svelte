<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'
  export let card: ExtractStructuredCard<'think-stream'>
</script>

<details class="think">
  <summary>Thought</summary>
  <pre class="body">{card.thinkingText}</pre>
</details>

<style>
  .think {
    border-left: 2px solid var(--border);
    padding: 2px 0 6px 14px;
    margin: 2px 0 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-3);
  }
  .think summary { cursor: pointer; color: #a78bfa; user-select: none; }
  .body {
    margin: 6px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.55;
    color: var(--text-3);
  }
</style>
