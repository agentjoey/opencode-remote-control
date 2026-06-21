<script lang="ts">
  import type { ExtractStructuredCard } from '../api/types.js'
  export let card: ExtractStructuredCard<'think-stream'>
  let open = false
</script>

<button class="toggle mono" on:click={() => (open = !open)} aria-expanded={open}>
  <span class="caret" class:open aria-hidden="true">▸</span>
  reasoning
</button>
{#if open}
  <div class="body mono">
    <pre>{card.thinkingText}</pre>
  </div>
{/if}

<style>
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0 0;
    padding: 0;
    background: transparent;
    border: none;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--hl-purple);
    cursor: pointer;
    user-select: none;
  }
  .toggle:hover { opacity: .85; }
  .caret {
    display: inline-block;
    transition: transform .2s ease;
  }
  .caret.open { transform: rotate(90deg); }
  .body {
    margin: 6px 0 8px;
    padding: 8px 10px 8px 12px;
    border-left: 2px solid var(--hl-purple);
    background: rgba(180, 140, 240, .06);
    border-radius: 0 8px 8px 0;
  }
  .body pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-2);
  }
</style>
