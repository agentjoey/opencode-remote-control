<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'
  import MarkdownView from './MarkdownView.svelte'

  export let card: ExtractStructuredCard<'info'>
</script>

<div class="card info">
  <div class="title">{card.title}</div>
  {#each card.sections as s}
    {#if s.heading}
      <div class="heading">{s.heading}</div>
    {/if}
    <MarkdownView src={s.body} />
    {#if s.code}
      <pre><code>{s.code.content}</code></pre>
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
    background: #14213d;
    color: #93c5fd;
    align-self: flex-start;
  }
  .title {
    font-weight: 600;
    margin-bottom: 6px;
  }
  .heading {
    font-weight: 600;
    font-size: 0.9em;
    margin-top: 8px;
    color: #bfdbfe;
  }
  pre {
    background: #0a1628;
    border-radius: 6px;
    padding: 8px;
    overflow-x: auto;
    font-size: 0.85em;
  }
</style>
