// Probe: what does kimi-code 0.18's session/list return, and is it cwd-scoped?
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const child = spawn('kimi', ['acp'], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env })
child.on('error', (e) => { console.error('spawn error', e); process.exit(1) })
const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
const conn = new ClientSideConnection(() => ({ sessionUpdate: () => Promise.resolve(), requestPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }) }), stream)

const done = (c) => { try { child.kill() } catch {} process.exit(c) }
setTimeout(() => { console.error('TIMEOUT'); done(2) }, 30000)

try {
  const init = await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'list-probe', version: '0' } })
  console.error('agentCapabilities =>', JSON.stringify(init?.agentCapabilities ?? init))
  // global (no cwd)
  try { const g = await conn.listSessions(); console.error('listSessions() (no args) =>', JSON.stringify(g).slice(0, 1500)) }
  catch (e) { console.error('listSessions() error:', e?.message ?? e) }
  // cwd-scoped (the dir OCRC e2e created a session in earlier lives under /tmp)
  try { const s = await conn.listSessions({ cwd: process.env.HOME }); console.error('listSessions({cwd:HOME}) =>', JSON.stringify(s).slice(0, 800)) }
  catch (e) { console.error('listSessions({cwd}) error:', e?.message ?? e) }
  done(0)
} catch (e) { console.error('error', e?.message ?? e); done(1) }
