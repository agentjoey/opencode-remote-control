<script lang="ts">
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'

  export let src: string

  $: html = DOMPurify.sanitize(marked.parse(src, { async: false }) as string)
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
  .md :global(h1, h2, h3, h4) { margin: 0.8em 0 0.4em; }
  .md :global(ul, ol) { padding-left: 1.5em; }
</style>
