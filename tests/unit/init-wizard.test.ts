import { describe, it, expect, vi } from 'vitest'
import { runInitWizard, type InitDeps } from '../../src/cli/init.js'

describe('init wizard', () => {
  function makeDeps(inputs: string[], files = new Map<string, string>()): { deps: InitDeps; outputs: string[] } {
    let idx = 0
    const outputs: string[] = []
    const deps: InitDeps = {
      ask: async (q) => {
        const ans = inputs[idx++] ?? ''
        return ans
      },
      writeFile: (path, content) => {
        files.set(path, content)
      },
      exists: (path) => files.has(path),
      testConnection: vi.fn().mockResolvedValue(undefined),
      cwd: '/test',
    }
    return { deps, outputs }
  }

  it('writes .env with token, user id, and spawn=true', async () => {
    const files = new Map<string, string>()
    const { deps } = makeDeps(['my-token-123', '987654321', 'Y'], files)
    await runInitWizard(deps)

    const env = files.get('/test/.env')
    expect(env).toBeDefined()
    expect(env).toContain('TELEGRAM_BOT_TOKEN=my-token-123')
    expect(env).toContain('ALLOWED_USER_IDS=987654321')
    expect(env).toContain('SPAWN_OPENCODE=true')
    expect(env).toContain('OPENCODE_BASE_URL=http://localhost:4096')
  })

  it('sets SPAWN_OPENCODE=false when user answers n', async () => {
    const files = new Map<string, string>()
    const { deps } = makeDeps(['tok', '123', 'n'], files)
    await runInitWizard(deps)

    const env = files.get('/test/.env')
    expect(env).toContain('SPAWN_OPENCODE=false')
  })

  it('calls testConnection with the token', async () => {
    const files = new Map<string, string>()
    const { deps } = makeDeps(['tok', '123', 'Y'], files)
    await runInitWizard(deps)
    expect(deps.testConnection).toHaveBeenCalledWith('tok')
  })

  it('overwrites existing .env when user confirms', async () => {
    const files = new Map<string, string>([['/test/.env', 'OLD=1']])
    const { deps } = makeDeps(['tok', '123', 'Y', 'y'], files)
    await runInitWizard(deps)
    expect(files.get('/test/.env')).toContain('TELEGRAM_BOT_TOKEN=tok')
  })
})
