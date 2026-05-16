import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'
import MarkdownView from './MarkdownView.svelte'

describe('MarkdownView', () => {
  it('renders h1 and strong', () => {
    const { container } = render(MarkdownView, { props: { src: '# Hello\n\n**bold**' } })
    expect(container.querySelector('h1')?.textContent).toBe('Hello')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
  })

  it('strips script tags via DOMPurify', () => {
    const { container } = render(MarkdownView, { props: { src: '<script>alert(1)</script>' } })
    expect(container.querySelector('script')).toBeNull()
  })
})
