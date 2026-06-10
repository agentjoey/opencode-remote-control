<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'
  export let card: ExtractStructuredCard<'user'>
</script>

<div class="user"><span class="prompt">&gt;</span><span class="text">{card.text}</span></div>

<style>
  .user {
    display: flex;
    gap: 8px;
    padding: 16px 0 6px;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
  }
  .prompt { color: var(--accent); flex-shrink: 0; user-select: none; }
  .text { color: var(--text); white-space: pre-wrap; word-break: break-word; }
</style>
