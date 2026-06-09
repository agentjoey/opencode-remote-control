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
  .md :global(pre) {
    background: #1a1a1a;
    border-radius: 8px;
    padding: 12px;
    overflow-x: auto;
  }
  .md :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.9em;
  }
  .md :global(p) { margin: 0.5em 0; }
  .md :global(h1) { margin: 0.8em 0 0.4em; }
  .md :global(h2) { margin: 0.8em 0 0.4em; }
  .md :global(h3) { margin: 0.8em 0 0.4em; }
  .md :global(h4) { margin: 0.8em 0 0.4em; }
  .md :global(ul) { padding-left: 1.5em; }
  .md :global(ol) { padding-left: 1.5em; }
</style>
