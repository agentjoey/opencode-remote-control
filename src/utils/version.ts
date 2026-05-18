import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string }

const START_TIME = Date.now()

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

const GIT_COMMIT = getGitCommit()

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export interface VersionInfo {
  version: string
  commit: string
  uptime: string
  uptimeMs: number
  node: string
  startedAt: string
}

export function getVersionInfo(): VersionInfo {
  return {
    version: pkg.version,
    commit: GIT_COMMIT,
    uptime: formatUptime(Date.now() - START_TIME),
    uptimeMs: Date.now() - START_TIME,
    node: process.version,
    startedAt: new Date(START_TIME).toISOString(),
  }
}
