import { describe, it, expect, vi } from 'vitest'
import { createSupervisor } from '../../src/launcher/spawn'

describe('createSupervisor', () => {
  it('spawns a child and exposes pid', async () => {
    const sup = createSupervisor({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      logFile: '/dev/null',
    })
    await sup.start()
    expect(sup.pid).toBeGreaterThan(0)
    await sup.stop()
  })

  it('restarts child on unexpected exit with backoff', async () => {
    let exits = 0
    const sup = createSupervisor({
      command: 'node',
      args: ['-e', 'process.exit(1)'],
      logFile: '/dev/null',
      restartBackoffMs: [50, 100],
      onExit: () => { exits++ },
    })
    await sup.start()
    await new Promise((r) => setTimeout(r, 500))
    expect(exits).toBeGreaterThanOrEqual(2)
    await sup.stop()
  })

  it('stop() kills child cleanly', async () => {
    const sup = createSupervisor({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      logFile: '/dev/null',
    })
    await sup.start()
    const pid = sup.pid
    await sup.stop()
    // Verify process gone (best-effort)
    try {
      process.kill(pid!, 0)
      throw new Error(`process ${pid} still alive`)
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('ESRCH')
    }
  })
})
