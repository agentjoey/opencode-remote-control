<script lang="ts">
  import { onDestroy } from 'svelte'
  import { renderMarkdown } from '../markdown/sanitize.js'

  export let src: string
  /** Streaming cards set this so re-parses coalesce to one per animation frame. */
  export let throttle = false
  /** Show a blinking caret at the end of the final paragraph. */
  export let streaming = false

  let html = ''
  let lastApplied: string | undefined
  let raf = 0
  let pending = ''

  function langOf(codeEl: HTMLElement): string {
    const cls = Array.from(codeEl.classList).find((c) => c.startsWith('language-'))
    return cls ? cls.slice(9) : ''
  }

  function transformCodeBlocks(markup: string): string {
    if (typeof document === 'undefined') return markup
    const wrap = document.createElement('div')
    wrap.innerHTML = markup
    const blocks = Array.from(wrap.querySelectorAll('pre > code')) as HTMLElement[]
    blocks.forEach((code) => {
      const pre = code.parentElement
      if (!pre) return
      const lang = langOf(code)
      const block = document.createElement('div')
      block.className = 'code-block'
      const header = document.createElement('div')
      header.className = 'code-header'
      const square = document.createElement('span')
      square.className = 'code-square'
      square.setAttribute('aria-hidden', 'true')
      const tag = document.createElement('span')
      tag.className = 'code-lang mono'
      tag.textContent = lang
      header.appendChild(square)
      header.appendChild(tag)
      block.appendChild(header)
      pre.parentNode?.insertBefore(block, pre)
      block.appendChild(pre)
    })
    return wrap.innerHTML
  }

  function insertStreamingCaret(wrap: HTMLElement) {
    const caret = document.createElement('span')
    caret.className = 'stream-caret'
    caret.setAttribute('aria-hidden', 'true')
    const paragraphs = Array.from(wrap.querySelectorAll('p'))
    if (paragraphs.length > 0) {
      const last = paragraphs[paragraphs.length - 1]
      last.appendChild(caret)
    } else {
      wrap.appendChild(caret)
    }
  }

  function apply(text: string) {
    if (text === lastApplied) return // memoize — skip re-parse of unchanged text
    lastApplied = text
    let rendered = renderMarkdown(text)
    rendered = transformCodeBlocks(rendered)
    if (streaming && typeof document !== 'undefined') {
      const wrap = document.createElement('div')
      wrap.innerHTML = rendered
      insertStreamingCaret(wrap)
      rendered = wrap.innerHTML
    }
    html = rendered
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

<div class="md" class:streaming>{@html html}</div>

<style>
  .md {
    font-family: var(--font-sans);
    font-size: 15px;
    color: var(--text);
    line-height: 1.72;
    word-break: break-word;
  }
  .md :global(p) { margin: 0.55em 0; }
  .md :global(p:first-child) { margin-top: 0; }
  .md :global(p:last-child) { margin-bottom: 0; }

  .md :global(.code-block) {
    background: #151412;
    border: 1px solid var(--border-2);
    border-radius: 9px;
    overflow: hidden;
    margin: 0.7em 0;
  }
  .md :global(.code-header) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 11px;
    background: rgba(255,255,255,.025);
    border-bottom: 1px solid var(--border-2);
  }
  .md :global(.code-square) {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--hl-cyan);
  }
  .md :global(.code-lang) {
    font-size: 11px;
    color: var(--hl-cyan);
    text-transform: lowercase;
  }
  .md :global(pre) {
    background: #151412;
    margin: 0;
    padding: 10px 12px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
  }
  .md :global(pre code) {
    background: transparent;
    padding: 0;
    font-size: inherit;
    color: var(--text);
  }
  .md :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--bg-input);
    padding: 0.1em 0.3em;
    border-radius: 4px;
    color: var(--hl-green);
  }
  .md :global(a) { color: var(--accent); }
  .md :global(h1), .md :global(h2), .md :global(h3), .md :global(h4) {
    margin: 0.75em 0 0.4em;
    color: var(--text);
    font-weight: 600;
  }
  .md :global(ul), .md :global(ol) {
    padding-left: 1.35em;
    margin: 0.5em 0;
  }
  .md :global(ul) { list-style: none; }
  .md :global(ul li) {
    position: relative;
    margin: 0.25em 0;
  }
  .md :global(ul li::before) {
    content: '▪';
    position: absolute;
    left: -1.1em;
    color: var(--accent);
    font-size: 0.85em;
  }
  .md :global(.raw) { color: var(--text-2); }

  .md :global(.stream-caret) {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--accent);
    margin-left: 2px;
    vertical-align: text-bottom;
    animation: ocrc-blink 1s step-end infinite;
  }

  /* GFM tables — marked emits real <table>; style it to match the TUI. */
  .md :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    border-collapse: collapse;
    margin: 0.6em 0;
    font-size: 13px;
    line-height: 1.5;
  }
  .md :global(th), .md :global(td) {
    border: 1px solid var(--border);
    padding: 5px 10px;
    text-align: left;
    vertical-align: top;
  }
  .md :global(thead th), .md :global(table tr:first-child th) {
    background: var(--bg-elev);
    color: var(--text);
    font-weight: 600;
  }
  .md :global(tbody tr:nth-child(even) td) { background: var(--bg-input); }
</style>
