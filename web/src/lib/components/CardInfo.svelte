<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'
  import MarkdownView from './MarkdownView.svelte'

  export let card: ExtractStructuredCard<'info'>
</script>

<div class="card info">
  <div class="title"><span class="ico" aria-hidden="true">ℹ</span> {card.title}</div>
  {#each card.sections as s}
    {#if s.heading}
      <div class="heading">{s.heading}</div>
    {/if}
    <div class="body"><MarkdownView src={s.body} /></div>
    {#if s.code}
      <pre><code>{s.code.content}</code></pre>
    {/if}
  {/each}
</div>

<style>
  .card {
    align-self: flex-start;
    max-width: 80%;
    margin: 4px 0;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text-2);
    line-height: 1.45;
    font-size: 13px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 12px;
    color: var(--text);
    margin-bottom: 4px;
  }
  .ico { color: var(--text-3); }
  .heading {
    font-weight: 600;
    font-size: 12px;
    margin-top: 8px;
    color: var(--text-2);
  }
  .body { font-size: 13px; }
  pre {
    background: var(--bg);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    margin: 6px 0 0;
    overflow-x: auto;
    font-size: 11px;
    line-height: 1.45;
  }
  code { font-family: var(--font-mono); color: var(--text-2); }
</style>
