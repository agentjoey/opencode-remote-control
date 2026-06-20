// One-off probe: spawn `kimi acp`, elicit a plan + a file edit, and dump the RAW
// session/update payloads so we can confirm the exact field names AcpBackend reads
// (plan `entries`, tool_call diff `content[].{type,path,oldText,newText}`).
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const cwd = mkdtempSync(join(tmpdir(), 'ocrc-acp-probe-'))
console.error('[probe] workdir', cwd)

const planSeen = []
const diffSeen = []
const updateTypes = new Set()

const child = spawn('kimi', ['acp'], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env })
child.on('error', (e) => { console.error('[probe] spawn error', e); process.exit(1) })

const stream = ndJsonStream(
  Writable.toWeb(child.stdin),
  Readable.toWeb(child.stdout),
)

const conn = new ClientSideConnection(
  () => ({
    sessionUpdate: (p) => {
      const u = p.update ?? p
      updateTypes.add(u.sessionUpdate)
      if (u.sessionUpdate === 'plan') { planSeen.push(u); console.error('[probe] PLAN =>', JSON.stringify(u)) }
      if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
        console.error('[probe] RAW_TOOLCALL =>', JSON.stringify(u).slice(0, 700))
        for (const it of (Array.isArray(u.content) ? u.content : [])) if (it && it.type === 'diff') { diffSeen.push(it); console.error('[probe] DIFF =>', JSON.stringify(it)) }
      }
      return Promise.resolve()
    },
    requestPermission: (p) => {
      const opts = p.options ?? []
      const pick = opts.find((o) => o.kind === 'allow_once') ?? opts.find((o) => String(o.kind ?? '').startsWith('allow')) ?? opts[0]
      console.error('[probe] PERMISSION', p.toolCall?.title, '=> allow', pick?.optionId)
      return Promise.resolve({ outcome: { outcome: 'selected', optionId: pick?.optionId } })
    },
  }),
  stream,
)

const done = (code) => { try { child.kill() } catch {}
  console.error('\n[probe] update types seen:', [...updateTypes].join(', '))
  console.error('[probe] plan updates:', planSeen.length, '| diff blocks:', diffSeen.length)
  if (planSeen[0]) console.error('[probe] FIRST PLAN KEYS:', Object.keys(planSeen[0]), '| entry keys:', planSeen[0].entries?.[0] ? Object.keys(planSeen[0].entries[0]) : '(no entries field)')
  if (diffSeen[0]) console.error('[probe] FIRST DIFF KEYS:', Object.keys(diffSeen[0]))
  process.exit(code)
}

setTimeout(() => { console.error('[probe] TIMEOUT'); done(2) }, 110000)

try {
  await conn.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'probe', version: '0' },
  })
  const { sessionId } = await conn.newSession({ cwd, mcpServers: [] })
  console.error('[probe] session', sessionId)
  const res = await conn.prompt({
    sessionId,
    prompt: [{ type: 'text', text: 'You MUST first call your plan/TODO tool to record a 3-step plan. Then create a file notes.txt containing the line "line one", then edit notes.txt to change "line one" to "line two". Keep it minimal.' }],
  })
  console.error('[probe] stopReason', res?.stopReason)
  done(0)
} catch (e) {
  console.error('[probe] error', e?.message ?? e)
  done(1)
}
