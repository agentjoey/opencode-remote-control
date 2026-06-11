import type { MiddlewareHandler } from 'hono'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { AuthStrategy, AuthUser } from './index.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('auth-token')
const COOKIE = 'ocrc_token'

export interface TokenAuthOptions {
  /** Explicit token (from config). If absent, load/generate from tokenPath. */
  token?: string
  /** Token file path. Default ${OPENCODE_CONFIG_DIR ?? ~/.opencode}/oprc-token. */
  tokenPath?: string
  /** Identity email for the single user. */
  devEmail?: string
  /** Bypass auth for a real loopback peer (local dev). */
  devBypass?: boolean
  /** Bind host, used as the bypass signal when the socket peer is unknown. */
  host?: string
}

function defaultTokenPath(): string {
  const dir = process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), '.opencode')
  return join(dir, 'oprc-token')
}

/** Resolve the web token: explicit > existing file > freshly generated (persisted 0600). */
export function loadOrCreateToken(opts: TokenAuthOptions = {}): string {
  if (opts.token && opts.token.trim()) return opts.token.trim()
  const path = opts.tokenPath ?? defaultTokenPath()
  try {
    if (existsSync(path)) {
      const t = readFileSync(path, 'utf-8').trim()
      if (t) return t
    }
  } catch {
    /* fall through to generate */
  }
  const token = randomBytes(32).toString('base64url')
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, token, { mode: 0o600 })
    try {
      chmodSync(path, 0o600)
    } catch {
      /* best effort */
    }
    log.info(`generated web token at ${path}`)
  } catch (err) {
    log.warn(`could not persist token: ${(err as Error).message}`)
  }
  return token
}

function isLoopbackAddr(addr?: string): boolean {
  if (!addr) return false
  const clean = addr.replace(/^::ffff:/, '').split('%')[0]
  return clean === '127.0.0.1' || clean === '::1'
}

function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function extractToken(
  headers: Record<string, string | string[] | undefined>,
  url?: string,
): string | undefined {
  const auth = headers['authorization']
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim()
  if (url && url.includes('?')) {
    const q = new URLSearchParams(url.split('?')[1])
    const t = q.get('token')
    if (t) return t
  }
  const cookie = headers['cookie']
  if (typeof cookie === 'string') {
    const m = cookie.match(new RegExp(`${COOKIE}=([^;]+)`))
    if (m) return decodeURIComponent(m[1])
  }
  return undefined
}

export function createTokenAuth(opts: TokenAuthOptions): AuthStrategy {
  const expected = loadOrCreateToken(opts)
  const user: AuthUser = { email: opts.devEmail ?? 'you@local', sub: 'token' }
  const bypass = (peer: string | undefined): boolean => {
    if (!opts.devBypass) return false
    const peerKnown = peer !== undefined && peer !== ''
    return peerKnown ? isLoopbackAddr(peer) : isLoopbackAddr(opts.host)
  }

  return {
    httpMiddleware(): MiddlewareHandler {
      return async (c, next) => {
        const peer = ((): string | undefined => {
          try {
            return ((c.env as any)?.incoming ?? (c.req as any)?.raw)?.socket?.remoteAddress
          } catch {
            return undefined
          }
        })()
        if (bypass(peer)) {
          c.set('user', user)
          return next()
        }
        const candidate =
          (c.req.header('authorization')?.startsWith('Bearer ')
            ? c.req.header('authorization')!.slice(7).trim()
            : undefined) ??
          c.req.query('token') ??
          c.req.header('cookie')?.match(new RegExp(`${COOKIE}=([^;]+)`))?.[1]
        if (tokenMatches(candidate, expected)) {
          c.set('user', user)
          return next()
        }
        return c.json({ error: 'Unauthorized' }, 401)
      }
    },
    async verifyUpgrade(req) {
      if (bypass(req.socket?.remoteAddress)) return user
      const candidate = extractToken(req.headers, req.url)
      return tokenMatches(candidate, expected) ? user : null
    },
  }
}
