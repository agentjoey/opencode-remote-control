<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'

  export let card: ExtractStructuredCard<'status'>

  $: title = card.fields.title ?? 'Status'
  $: fields = Object.entries(card.fields).filter(([k]) => k !== 'title')
</script>

<div class="status" class:rich={fields.length > 0}>
  <span class="dot" aria-hidden="true"></span>
  <span class="ttl">{title}</span>
  {#each fields as [key, value]}
    <span class="field"><span class="key">{key}</span> {value}</span>
  {/each}
</div>

<style>
  .status {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    max-width: 80%;
    margin: 4px 0;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.4;
  }
  .status.rich { border-radius: var(--radius-sm); }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .ttl { font-weight: 600; color: var(--text); }
  .field { color: var(--text-3); }
  .key { color: var(--text-2); }
</style>
