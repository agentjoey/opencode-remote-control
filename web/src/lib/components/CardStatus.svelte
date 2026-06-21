<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'

  export let card: ExtractStructuredCard<'status'>

  $: title = card.fields.title ?? 'Status'
  $: fields = Object.entries(card.fields).filter(([k]) => k !== 'title')
  $: extra = fields.map(([k, v]) => `${k}: ${v}`).join(' · ')
  $: text = [title, extra].filter(Boolean).join(' · ')
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
