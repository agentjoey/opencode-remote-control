<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'

  export let card: ExtractStructuredCard<'user'>
</script>

<div class="card user">{card.text}</div>

<style>
  .card {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 12px;
    margin: 6px 0;
    line-height: 1.4;
  }
  .user {
    background: #2563eb;
    color: #fff;
    align-self: flex-end;
    white-space: pre-wrap;
  }
</style>
