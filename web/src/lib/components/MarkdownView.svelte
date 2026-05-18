<script lang="ts">
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'

  export let src: string

  // Cap markdown rendering at 20k chars — anything longer is shown as raw text.
  // Some assistant outputs (long extraction tasks, JSON blobs) blow up marked's
  // tokenizer and freeze the main thread for 5+ seconds.
  const MAX_MARKDOWN_LEN = 20_000

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function render(text: string): string {
    if (text.length > MAX_MARKDOWN_LEN) {
      return `<pre class="raw">${escapeHtml(text)}</pre>`
    }
    try {
      return DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
    } catch {
      return `<pre class="raw">${escapeHtml(text)}</pre>`
    }
  }

  $: html = render(src)
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
