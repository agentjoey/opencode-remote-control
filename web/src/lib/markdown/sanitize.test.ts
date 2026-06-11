import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './sanitize.js'

describe('sanitize', () => {
  it('outputs hljs- classes for fenced ts code blocks', () => {
    const md = '```ts\nconst x: string = "hello"\n```'
    const html = renderMarkdown(md)
    expect(html).toContain('hljs-')
  })

  it('preserves hljs-keyword span after DOMPurify', () => {
    const md = '```ts\nconst x = 1\n```'
    const html = renderMarkdown(md)
    expect(html).toContain('<span class="hljs-keyword">')
  })

  it('handles unknown language with highlightAuto', () => {
    const md = '```fakelang\nsome code\n```'
    const html = renderMarkdown(md)
    expect(html).toContain('hljs-')
    expect(html).toContain('language-fakelang')
  })

  it('falls back to plain text on very long input', () => {
    const long = 'x'.repeat(30_000)
    const html = renderMarkdown(long)
    expect(html).not.toContain('hljs-')
    expect(html).toContain('<pre class="raw">')
  })

  it('handles malformed markdown gracefully', () => {
    // Unbalanced code fence
    const md = '```\nunclosed'
    const html = renderMarkdown(md)
    expect(html).toBeDefined()
    expect(typeof html).toBe('string')
  })

  it('renders inline code with emerald color', () => {
    const md = 'Use `readFile` to open the document.'
    const html = renderMarkdown(md)
    expect(html).toContain('<code>readFile</code>')
  })

  it('preserves <a> targets', () => {
    const md = '[link](https://example.com)'
    const html = renderMarkdown(md)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
