<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'

  export let card: ExtractStructuredCard<'info'>
  $: body = card.sections.map((s) => s.body).join(' ') || ''
  $: text = [card.title, body].filter(Boolean).join(' — ')
</script>

<div class="note mono">{text}</div>

<style>
  .note {
    align-self: center;
    max-width: 80%;
    margin: 6px 0;
    padding: 6px 12px;
    text-align: center;
    font-size: 12.5px;
    color: var(--text-3);
    line-height: 1.5;
  }
</style>
