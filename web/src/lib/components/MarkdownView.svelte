<script lang="ts">
  import { onDestroy } from 'svelte'
  import { renderMarkdown } from '../markdown/sanitize.js'

  export let src: string
  /** Streaming cards set this so re-parses coalesce to one per animation frame. */
  export let throttle = false

  let html = ''
  let lastApplied: string | undefined
  let raf = 0
  let pending = ''

  function apply(text: string) {
    if (text === lastApplied) return // memoize — skip re-parse of unchanged text
    lastApplied = text
    html = renderMarkdown(text)
  }

  function schedule(text: string) {
    if (!throttle || typeof requestAnimationFrame === 'undefined') {
      apply(text)
      return
    }
    pending = text
    if (raf) return
    raf = requestAnimationFrame(() => { raf = 0; apply(pending) })
  }

  $: schedule(src)

  onDestroy(() => { if (raf) cancelAnimationFrame(raf) })
</script>

<div class="md">{@html html}</div>

<style>
  .md {
    font-family: var(--font-sans);
    font-size: 15px;
    color: var(--text);
    line-height: 1.7;
    word-break: break-word;
  }
  .md :global(pre) {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    overflow-x: auto;
  }
  .md :global(pre code) { color: var(--text); }
  .md :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--bg-input);
    padding: 0.1em 0.3em;
    border-radius: 4px;
    color: var(--hl-green);
  }
  .md :global(pre code) { background: transparent; padding: 0; }
  .md :global(a) { color: var(--accent); }
  .md :global(p) { margin: 0.45em 0; }
  .md :global(h1), .md :global(h2), .md :global(h3), .md :global(h4) { margin: 0.7em 0 0.35em; color: var(--text); }
  .md :global(ul), .md :global(ol) { padding-left: 1.4em; margin: 0.4em 0; }
  .md :global(.raw) { color: var(--text-2); }
</style>
