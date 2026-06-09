import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Cap markdown rendering — very long outputs (extraction tasks, JSON blobs)
// blow up marked's tokenizer and freeze the main thread for seconds.
const MAX_MARKDOWN_LEN = 20_000

// Force external links to open safely (new tab, no window.opener handle, no
// referrer). Registered once at module load.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const PURIFY_CONFIG = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  FORBID_ATTR: ['style'],
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Render markdown to a sanitized HTML string. Falls back to escaped raw text. */
export function renderMarkdown(text: string): string {
  if (text.length > MAX_MARKDOWN_LEN) {
    return `<pre class="raw">${escapeHtml(text)}</pre>`
  }
  try {
    return DOMPurify.sanitize(marked.parse(text, { async: false }) as string, PURIFY_CONFIG)
  } catch {
    return `<pre class="raw">${escapeHtml(text)}</pre>`
  }
}
