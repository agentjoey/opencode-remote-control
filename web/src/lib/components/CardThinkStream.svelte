<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'
  export let card: ExtractStructuredCard<'think-stream'>
</script>

<details class="think-stream" open>
  <summary>💭 Thinking…</summary>
  <pre class="think-body">{card.thinkingText}</pre>
</details>

<style>
  .think-stream {
    margin: 8px 0;
    padding: 8px 12px;
    border-left: 3px solid #e5c07b;
    background: #fdf6e3;
    border-radius: 0 6px 6px 0;
    font-size: 0.85em;
    color: #7c6f64;
  }
  .think-stream summary {
    cursor: pointer;
    font-weight: 600;
    color: #b1624d;
  }
  .think-body {
    margin: 6px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, monospace;
    line-height: 1.5;
  }
</style>
