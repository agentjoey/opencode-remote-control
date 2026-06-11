<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'

  export let card: ExtractStructuredCard<'error'>
</script>

<div class="card error">
  <div class="head"><span class="ico" aria-hidden="true">⚠</span> Error</div>
  <code>{card.message}</code>
</div>

<style>
  .card {
    align-self: flex-start;
    max-width: 80%;
    margin: 4px 0;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    border-left: 2px solid var(--err);
    background: var(--bg-elev);
    line-height: 1.4;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--err);
  }
  code {
    display: block;
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.45;
    background: var(--bg);
    border: 1px solid var(--border-2);
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    color: var(--text-2);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
