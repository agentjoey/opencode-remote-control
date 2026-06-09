// Patch Telegraf's redactToken to work around Bun's readonly Error.message property
// See: https://github.com/telegraf/telegraf/issues/2078
const fs = require('fs')
const path = require('path')

const clientPath = path.join(__dirname, '..', 'node_modules', 'telegraf', 'lib', 'core', 'network', 'client.js')
const pollingPath = path.join(__dirname, '..', 'node_modules', 'telegraf', 'lib', 'core', 'network', 'polling.js')

if (!fs.existsSync(clientPath)) {
  console.log('[patch-telegraf] client.js not found, skipping')
  process.exit(0)
}

// 1. Patch redactToken for Bun compatibility
let content = fs.readFileSync(clientPath, 'utf8')

const oldFunc = `function redactToken(error) {
    error.message = error.message.replace(/\\/(bot|user)(\\d+):[^/]+\\//, '/$1$2:[REDACTED]/');
    throw error;
}`

const newFunc = `function redactToken(error) {
    try {
        error.message = error.message.replace(/\\/(bot|user)(\\d+):[^/]+\\//, '/$1$2:[REDACTED]/');
    } catch {
        Object.defineProperty(error, 'message', {
            value: error.message.replace(/\\/(bot|user)(\\d+):[^/]+\\//, '/$1$2:[REDACTED]/'),
            writable: true,
            configurable: true,
        });
    }
    throw error;
}`

let patched = false

if (content.includes('try {\n        error.message = error.message.replace')) {
  console.log('[patch-telegraf] redactToken already patched')
} else if (content.includes('error.message = error.message.replace')) {
  content = content.replace(oldFunc, newFunc)
  patched = true
}

// 2. Replace node-fetch with Bun's native fetch to fix TLS connectivity
//    Bun's https.Agent polyfill is unreliable; native fetch works correctly.
const nodeFetchImport = 'const node_fetch_1 = __importDefault(require("node-fetch"));'
const bunFetchShim = `const node_fetch_1 = {
  __esModule: true,
  default: async function bunFetch(url, init) {
    const { agent, timeout, ...rest } = init || {}
    const ctrl = new AbortController()
    const timer = timeout ? setTimeout(() => ctrl.abort(), timeout) : null
    try {
      const res = await fetch(url, { ...rest, signal: init?.signal || ctrl.signal })
      // Make node-fetch response quack like node-fetch Response
      res.json = res.json.bind(res)
      res.text = res.text.bind(res)
      res.buffer = async () => Buffer.from(await res.arrayBuffer())
      return res
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
__setModuleDefault(node_fetch_1, node_fetch_1.default)`

if (content.includes(nodeFetchImport)) {
  content = content.replace(nodeFetchImport, bunFetchShim)
  patched = true
  console.log('[patch-telegraf] node-fetch → Bun native fetch')
} else {
  console.log('[patch-telegraf] node-fetch replacement not needed or already done')
}

if (patched) {
  fs.writeFileSync(clientPath, content, 'utf8')
  console.log('[patch-telegraf] client.js patched')
}

// 3. Patch polling.js to handle Bun TimeoutError as a retryable error
if (fs.existsSync(pollingPath)) {
  let pollContent = fs.readFileSync(pollingPath, 'utf8')
  if (!pollContent.includes("err.name === 'TimeoutError'")) {
    const retryCond = "err.name === 'FetchError' ||"
    const expandedRetry = "err.name === 'TimeoutError' || err.name === 'FetchError' ||"
    if (pollContent.includes(retryCond)) {
      pollContent = pollContent.replace(retryCond, expandedRetry)
      fs.writeFileSync(pollingPath, pollContent, 'utf8')
      console.log('[patch-telegraf] polling.js TimeoutError → retryable')
    }
  } else {
    console.log('[patch-telegraf] polling.js already patched')
  }
}
