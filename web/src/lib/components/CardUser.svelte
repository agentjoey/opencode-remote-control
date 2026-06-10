<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'
  export let card: ExtractStructuredCard<'user'>
</script>

<div class="card user">{card.text}</div>

<style>
  .card {
    align-self: flex-end;
    max-width: 80%;
    padding: 11px 16px;
    border-radius: 18px 18px 4px 18px;
    margin: 14px 0 6px;
    line-height: 1.55;
    font-size: 14.5px;
    background: var(--user-bubble);
    color: var(--user-ink);
    box-shadow: 0 2px 12px rgba(63, 178, 127, .18);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
