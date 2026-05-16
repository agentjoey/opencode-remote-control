<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'

  export let card: ExtractStructuredCard<'error'>
</script>

<div class="card error">
  ❌ Error
  <code>{card.message}</code>
</div>

<style>
  .card {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 12px;
    margin: 6px 0;
    line-height: 1.4;
    background: #3f1d1d;
    color: #f87171;
    align-self: flex-start;
  }
  code {
    display: block;
    margin-top: 6px;
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
    background: #2a1515;
    padding: 6px;
    border-radius: 4px;
    color: #fca5a5;
  }
</style>
