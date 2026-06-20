import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import WorkingDirPanel from './WorkingDirPanel.svelte'
import { api } from '$lib/api/client.js'

vi.mock('$lib/api/client.js', () => ({
  api: {
    context: vi.fn(),
    diff: vi.fn(),
  },
}))

describe('WorkingDirPanel', () => {
  beforeEach(() => {
    vi.mocked(api.context).mockReset()
    vi.mocked(api.diff).mockReset()
  })

  it('lists changed file paths with addition/deletion counts', async () => {
    vi.mocked(api.context).mockResolvedValue({ directory: '/project' })
    vi.mocked(api.diff).mockResolvedValue([
      { path: 'src/foo.ts', additions: 2, deletions: 1, lines: [] },
      { path: 'src/bar.ts', additions: 0, deletions: 4, lines: [] },
    ])
    const { container } = render(WorkingDirPanel, { props: { sessionId: 's1' } })
    await tick()
    await vi.waitFor(() => expect(container.querySelectorAll('.f')).toHaveLength(2))
    expect(container.textContent).toContain('src/foo.ts')
    expect(container.textContent).toContain('+2 / −1')
    expect(container.textContent).toContain('src/bar.ts')
    expect(container.textContent).toContain('+0 / −4')
  })

  it('expands a file on click to show red/green diff lines', async () => {
    vi.mocked(api.context).mockResolvedValue({ directory: '/project' })
    vi.mocked(api.diff).mockResolvedValue([
      {
        path: 'src/a.ts',
        additions: 1,
        deletions: 1,
        lines: [
          { kind: 'ctx', text: ' context' },
          { kind: 'del', text: '-old' },
          { kind: 'add', text: '+new' },
        ],
      },
    ])
    const { container } = render(WorkingDirPanel, { props: { sessionId: 's1' } })
    await tick()
    await vi.waitFor(() => expect(container.querySelector('.f')).toBeTruthy())
    expect(container.querySelector('.diff')).toBeNull()
    await fireEvent.click(container.querySelector('.f')!)
    await tick()
    const diff = container.querySelector('.diff')
    expect(diff).not.toBeNull()
    const lines = diff!.querySelectorAll('.line')
    expect(lines).toHaveLength(3)
    expect(lines[0].classList.contains('ctx')).toBe(true)
    expect(lines[1].classList.contains('del')).toBe(true)
    expect(lines[1].textContent).toContain('−old')
    expect(lines[2].classList.contains('add')).toBe(true)
    expect(lines[2].textContent).toContain('+new')
  })

  it('collapses an expanded file on second click', async () => {
    vi.mocked(api.context).mockResolvedValue({ directory: '/project' })
    vi.mocked(api.diff).mockResolvedValue([
      {
        path: 'src/a.ts',
        additions: 1,
        deletions: 0,
        lines: [{ kind: 'add', text: '+x' }],
      },
    ])
    const { container } = render(WorkingDirPanel, { props: { sessionId: 's1' } })
    await tick()
    await vi.waitFor(() => expect(container.querySelector('.f')).toBeTruthy())
    await fireEvent.click(container.querySelector('.f')!)
    await tick()
    expect(container.querySelector('.diff')).not.toBeNull()
    await fireEvent.click(container.querySelector('.f')!)
    await tick()
    expect(container.querySelector('.diff')).toBeNull()
  })

  it('does not render a diff body for entries with empty lines', async () => {
    vi.mocked(api.context).mockResolvedValue({ directory: '/project' })
    vi.mocked(api.diff).mockResolvedValue([
      { path: 'src/empty.ts', additions: 5, deletions: 5, lines: [] },
    ])
    const { container } = render(WorkingDirPanel, { props: { sessionId: 's1' } })
    await tick()
    await vi.waitFor(() => expect(container.querySelector('.f')).toBeTruthy())
    await fireEvent.click(container.querySelector('.f')!)
    await tick()
    expect(container.querySelector('.diff')).toBeNull()
  })
})
