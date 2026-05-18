<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'

  export let card: ExtractStructuredCard<'status'>
</script>

<div class="card status">
  <div class="title">{card.fields.title ?? 'Status'}</div>
  {#each Object.entries(card.fields) as [key, value]}
    {#if key !== 'title'}
      <div class="field"><span class="key">{key}</span> {value}</div>
    {/if}
  {/each}
</div>

<style>
  .card {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 12px;
    margin: 6px 0;
    line-height: 1.4;
    background: #1e1b4b;
    color: #c4b5fd;
    align-self: flex-start;
  }
  .title {
    font-weight: 600;
    margin-bottom: 6px;
  }
  .field {
    font-size: 0.9em;
    margin-top: 4px;
  }
  .key {
    color: #8b5cf6;
    font-weight: 500;
  }
</style>
