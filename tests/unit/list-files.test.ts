import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listFiles } from '../../src/core/list-files'

describe('listFiles', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'lf-'))
    await writeFile(join(root, 'README.md'), 'x')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'index.ts'), 'x')
    await writeFile(join(root, 'src', 'util.ts'), 'x')
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg', 'x.js'), 'x')
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, '.git', 'config'), 'x')
  })
  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  it('lists workspace-relative files, skipping node_modules/.git', async () => {
    const files = await listFiles(root)
    expect(files).toContain('README.md')
    expect(files).toContain('src/index.ts')
    expect(files).toContain('src/util.ts')
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
    expect(files.some((f) => f.includes('.git'))).toBe(false)
  })

  it('filters by query (substring, case-insensitive)', async () => {
    expect(await listFiles(root, 'UTIL')).toEqual(['src/util.ts'])
  })

  it('respects the limit', async () => {
    expect(await listFiles(root, '', { limit: 1 })).toHaveLength(1)
  })
})
