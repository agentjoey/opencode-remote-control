# Phase 2 Design Spec — opencode-remote-control

## Goal

Extend the Telegram bot from a "fire-and-wait" relay into a richer control surface:
real-time streaming output, session/agent/model management commands, and polished
card-style UX for every slash command.

## Current architecture (Phase 1 baseline)

```
Telegram ──► bot/index.ts ──► handlers/chat.ts
                                 │
                                 ├─ opencode/tui-bridge.ts   (submit prompt)
                                 └─ opencode/event-stream.ts (SSE, waits for idle)
                                      then fetches full message via SDK client
```

Key files an implementer must understand:

| File | Role |
|------|------|
| `src/bot/handlers/chat.ts` | Main chat handler; owns the SSE for-await loop |
| `src/bot/handlers/commands.ts` | All slash commands |
| `src/bot/index.ts` | Wires deps, guards isGenerating, fire-and-forget handleChat |
| `src/bot/reply.ts` | createReplyStream — throttled Telegram message edit |
| `src/opencode/event-stream.ts` | Persistent SSE connection; `session()` async generator |
| `src/opencode/tui-bridge.ts` | Submits prompts via TUI inject or prompt_async fallback |
| `src/config.ts` | Zod env config (add new env vars here) |
| `src/utils/markdown.ts` | `escapeMarkdownV2`, `chunkMessage` |

Tests live in `tests/unit/`. Run with `npm test` (Vitest). Build with `npx tsc`.
Stack: TypeScript 5.4, Node 20, Telegraf v4, `@opencode-ai/sdk` v1.14.

---

## UX design principles (apply to every command)

All commands must render a **structured card** rather than plain text. Rules:

1. **Use HTML parse mode** (`{ parse_mode: 'HTML' }`) for all command replies.
   HTML is easier to write safely than MarkdownV2. Bold = `<b>text</b>`,
   code = `<code>text</code>`, italic = `<i>text</i>`.
   Chat output continues to use the existing MarkdownV2 path (`src/utils/markdown.ts`).

2. **Lead with a status emoji + title line.**
   `🟢 opencode healthy` beats `opencode: healthy`.

3. **Use inline keyboard buttons** (`Markup.inlineKeyboard`) wherever the user
   would otherwise have to type a follow-up command.
   Examples: agent list → tap to switch; sessions list → tap to pin; abort prompt → tap Abort.

4. **Callback handler convention**: register `bot.action('PREFIX:payload', ...)`.
   Prefix examples: `agent:switch`, `model:switch`, `session:pin`.
   After action: call `ctx.answerCbQuery()` + edit the original message to confirm.

5. **Keep cards ≤ 20 lines.** If a list is long (e.g. many models), paginate or
   truncate with a "… and N more" footer.

6. **Disable notification** for purely informational card updates
   (`disable_notification: true` is the default for Telegraf `ctx.reply`; no action needed).

---

## Feature 1: Live streaming output

### What it does

Stream the assistant's response incrementally into the Telegram message as SSE
delta events arrive. The user sees text growing in real time instead of a spinner.

### How opencode SSE works

Two event types are relevant (verify shapes against live server with
`curl -N http://localhost:4096/event` while a session runs):

- **`message.part.updated`** — part created/updated.
  Properties: `{ sessionID, messageID, part: { id, type, ... } }`
  `part.type` values include `"text"`, `"reasoning"`, `"step-start"`, `"step-finish"`,
  `"tool-invocation"`. Only `"text"` parts contain visible prose.

- **`message.part.delta`** — incremental chunk.
  Properties: `{ sessionID, messageID, partID, field, delta }`
  For text parts: `field === "text"`, `delta` is a string fragment.

### Implementation

**`src/bot/handlers/chat.ts`** — modify the for-await loop:

```typescript
// NEW state, before the for-await:
const textPartIds = new Set<string>()
let streamedText = ''

// Inside the for-await, ADD these branches alongside existing ones:
if (e.type === 'message.part.updated') {
  const part = e.properties?.part
  if (part?.type === 'text' && typeof part.id === 'string') {
    textPartIds.add(part.id)
  }
}

if (e.type === 'message.part.delta') {
  if (!assistantMessageId && typeof e.properties?.messageID === 'string') {
    assistantMessageId = e.properties.messageID
  }
  const partId = e.properties?.partID as string | undefined
  const field  = e.properties?.field  as string | undefined
  const delta  = e.properties?.delta  as string | undefined
  if (partId && textPartIds.has(partId) && field === 'text' && delta) {
    streamedText += delta
    await replyStream.update(streamedText)  // throttled by editThrottleMs
  }
}
```

After the loop, prefer `streamedText`; fall back to the existing SDK fetch only
when `streamedText` is empty (tool-only response, no text parts). Extract the
SDK fetch into a helper `fetchFinalMessage(sessionId, msgId, client)` to keep
`handleChat` readable.

**Config** — add `STREAM_OUTPUT` env var (default `"true"`):
```
STREAM_OUTPUT=true   # set false to revert to wait-then-show for debugging
```
Add to `src/config.ts` via Zod with `z.coerce.boolean().default(true)`.
Pass it through `ChatDeps` as `streamOutput: boolean`.

**Tests** (`tests/unit/chat.test.ts`):
- Streaming path: emit `message.part.updated` (type=text) then several
  `message.part.delta` events → verify `replyStream.update` called with
  accumulating text.
- Non-text part filter: emit `message.part.updated` (type=reasoning) then delta
  → verify update NOT called.
- Fallback path: no deltas → verify SDK fetch path used.
- `streamOutput: false` → verify streaming skipped entirely.

---

## Feature 2: /files command

### Card design

```
📁 Files — ses_abc…123

✏️  src/handlers/chat.ts
📖  package.json
✏️  src/config.ts
🆕  src/newfile.ts
🗑️  tmp/scratch.ts

5 file operations  ·  /current to see session
```

Emoji legend: `📖` read, `✏️` write/edit, `🆕` create, `🗑️` delete.
If more than 15 files, show first 15 then `…and N more`.

### Implementation

**`src/bot/handlers/commands.ts`** — add `/files`:

```typescript
const FILE_EMOJI: Record<string, string> = {
  read: '📖', write: '✏️', edit: '✏️', create: '🆕', delete: '🗑️',
}

deps.bot.command('files', async (ctx) => {
  const last = deps.getLastSessionId()
  if (!last) {
    await ctx.reply('No session yet. Send a message first.', { parse_mode: 'HTML' })
    return
  }

  const result = await deps.client.session.messages({ path: { id: last } })
  const msgs = (result.data ?? []) as MessageItem[]

  const FILE_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'create_file', 'delete_file'])
  const seen = new Map<string, string>()  // path → last operation

  for (const msg of msgs) {
    for (const part of (msg.parts ?? []) as PartItem[]) {
      if (part.type !== 'tool-invocation') continue
      const tool = (part.toolName ?? '') as string
      if (!FILE_TOOLS.has(tool)) continue
      const path = part.state?.input?.path ?? part.state?.input?.file_path as string
      if (path) seen.set(path, tool.replace('_file', ''))
    }
  }

  const shortId = last.slice(-8)
  if (seen.size === 0) {
    await ctx.reply(`<b>📁 Files — …${shortId}</b>\n\nNo file operations recorded.`, { parse_mode: 'HTML' })
    return
  }

  const MAX = 15
  const entries = [...seen.entries()]
  const shown = entries.slice(0, MAX)
  const lines = [
    `<b>📁 Files — …${shortId}</b>`, '',
    ...shown.map(([p, op]) => `${FILE_EMOJI[op] ?? '•'}  <code>${p}</code>`),
  ]
  if (entries.length > MAX) lines.push(`\n…and ${entries.length - MAX} more`)
  lines.push('', `<i>${entries.length} file operation${entries.length > 1 ? 's' : ''}</i>`)

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
})
```

Verify exact property paths (`part.toolName`, `part.state.input.path`) against
the live API before coding. The tool part shape may differ between opencode versions.

Add `{ command: 'files', description: 'Files touched in last session' }` to
`setMyCommands`.

**Tests** (`tests/unit/commands-files.test.ts`):
- Messages with tool parts → correct emoji-annotated file list.
- Empty session → "No file operations" card.
- > 15 files → truncation with count.

---

## Feature 3: /agent command

### Card design — list view

```
🤖 Agents

● default   General-purpose coding assistant
○ minimal   Lightweight, fast for simple tasks
○ research  Deep research and analysis

[Use default] [Use minimal] [Use research]
```

Current active agent shown with `●`; others with `○`.
Each agent gets an inline button. Tapping calls `agent:switch:<id>`.

### Card design — after switch

The original card message is edited to:
```
🤖 Agents

○ default   General-purpose coding assistant
● minimal   Lightweight, fast for simple tasks   ✓ active
○ research  Deep research and analysis
```

### API

```
GET /app/agents → { data: [{ id, name, description, ... }] }
```
Agent switching API: verify against the opencode server. Options:
- `PATCH /session/{id}` with `{ agentID: "..." }` — try this first.
- Or: create a new session with the agent preset.
If no switch API exists, show list as read-only and document the limitation.

### Implementation

**`src/bot/handlers/commands.ts`**:

```typescript
deps.bot.command('agent', async (ctx) => {
  const result = await deps.client.app.agents()
  const agents = (result?.data ?? []) as AgentItem[]

  const buttons = agents.map(a =>
    Markup.button.callback(a.name ?? a.id, `agent:switch:${a.id}`)
  )
  const lines = ['<b>🤖 Agents</b>', '']
  for (const a of agents) {
    lines.push(`• <b>${a.name ?? a.id}</b>  <i>${a.description ?? ''}</i>`)
  }

  await ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons.map(b => [b])),
  })
})

// Callback handler (register once in bot setup, not inside registerCommands):
bot.action(/^agent:switch:(.+)$/, async (ctx) => {
  const agentId = ctx.match[1]
  const last = lastSessionIdGetter()
  if (!last) { await ctx.answerCbQuery('No active session'); return }
  try {
    // PATCH /session/{last} with agentID — verify API first
    await fetch(`${baseUrl}/session/${last}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentID: agentId }),
      signal: AbortSignal.timeout(5000),
    })
    await ctx.answerCbQuery(`Switched to ${agentId}`)
    await ctx.editMessageText(`<b>🤖 Agent switched</b>\n\nNow using: <code>${agentId}</code>`, { parse_mode: 'HTML' })
  } catch (err) {
    await ctx.answerCbQuery('Switch failed')
  }
})
```

The callback handler needs access to `lastSessionId` and `baseUrl`. Pass them
via closure from `createBot()` or add a `registerCallbacks(deps)` function
alongside `registerCommands`.

**Tests**: list display, button callback wiring, switch success/failure.

---

## Feature 4: /model command

### Card design — list view

```
⚙️ Model

Anthropic
  ● claude-sonnet-4-6   (current)
  ○ claude-opus-4-7
  ○ claude-haiku-4-5

[claude-sonnet-4-6 ✓] [claude-opus-4-7] [claude-haiku-4-5]
```

Grouped by provider. Current model marked with `●` and `(current)`.
Buttons use callback `model:switch:<provider>:<modelId>`.

### API

```
GET /config/providers → { data: { [provider]: { models: [...], ... } } }
```
Or `deps.client.config.providers()` — verify SDK method name.

Model switching: likely a config patch rather than per-session.
```
PATCH /config/providers  body: { default: { modelID: "..." } }
```
Verify against opencode source or by watching TUI network traffic when switching
models in the UI.

### Implementation

Similar structure to `/agent`. Group models by provider. Register
`bot.action(/^model:switch:(.+):(.+)$/, ...)` callback. Show at most 3
providers × 4 models = 12 buttons; truncate if more.

---

## Feature 5: /session command (pin to session)

### Card design — /sessions (enhanced existing command)

```
📋 Sessions

1  ses_abc…123   My project chat
   May 15 · 20:18  [Pin this]

2  ses_def…456   Untitled
   May 14 · 10:05  [Pin this]

📌 Pinned: ses_abc…123
```

Each session row gets a `[Pin this]` inline button → callback `session:pin:<id>`.

### /session command (new — no-arg = show pinned, arg = pin directly)

Card design:
```
📌 Pinned session

ses_abc…123
Title: My project chat
Created: May 15 · 20:18

[Unpin]
```

### Implementation

**`src/bot/handlers/commands.ts`**:

```typescript
// Enhance existing /sessions command to add [Pin this] buttons:
deps.bot.command('sessions', async (ctx) => {
  // ...existing list fetch...
  const rows = sessions.map(s => [
    Markup.button.callback(`📌 Pin ${s.id.slice(-6)}`, `session:pin:${s.id}`)
  ])
  await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) })
})

// New /session command:
deps.bot.command('session', async (ctx) => {
  const args = ctx.message?.text?.split(' ').slice(1)[0]?.trim()
  if (args) {
    deps.setLastSessionId(args)
    await ctx.reply(`<b>📌 Pinned</b>\n\n<code>${args}</code>`, { parse_mode: 'HTML' })
    return
  }
  const last = deps.getLastSessionId()
  if (!last) {
    await ctx.reply('No session pinned. Send a message or use /sessions.', { parse_mode: 'HTML' })
    return
  }
  await ctx.reply(
    `<b>📌 Pinned session</b>\n\n<code>${last}</code>`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('Unpin', 'session:unpin')]]),
    }
  )
})

// Callback — register in createBot():
bot.action(/^session:pin:(.+)$/, async (ctx) => {
  const id = ctx.match[1]
  deps.setLastSessionId(id)
  await ctx.answerCbQuery(`Pinned ${id.slice(-8)}`)
  await ctx.editMessageText(`<b>📌 Pinned to ${id.slice(-8)}</b>`, { parse_mode: 'HTML' })
})
bot.action('session:unpin', async (ctx) => {
  deps.setLastSessionId(undefined as any)
  await ctx.answerCbQuery('Unpinned')
  await ctx.editMessageText('Session unpinned.', { parse_mode: 'HTML' })
})
```

`setLastSessionId` must accept `undefined` to support unpin — update the type.

---

## Enhance existing commands

### /status — new card design

```
🟢 opencode healthy  ·  v1.15.0
📊 2 sessions  ·  1 busy
📌 ses_abc…123

[Refresh]  [Abort]
```

`[Refresh]` → callback `status:refresh` → edit the message with new data.
`[Abort]` → same logic as `/abort` command (only shown when `isGenerating`).

### /start and /help — new card design

```
👋 Hi Alice!

opencode remote control ready.
Send any text to relay to the TUI.

Commands:
  /status   Server health + session
  /sessions List all sessions
  /session  Pin a session
  /files    Files touched in last session
  /agent    Switch agent
  /model    Switch model
  /abort    Stop generation
  /help     This message

[Check status]
```

`[Check status]` → callback `status:refresh`.

---

## Callback handler architecture

All `bot.action()` handlers need access to shared state (`lastSessionId`,
`baseUrl`, `isGenerating`). Two options:

**Option A (recommended):** Add `registerCallbacks(deps)` function in a new
file `src/bot/handlers/callbacks.ts`, called from `createBot()` after
`registerCommands()`. Pass all needed deps explicitly.

**Option B:** Inline all callbacks inside `createBot()` via closures.

Option A is cleaner for testability. Keep each callback focused:
check for required deps, call the API, `answerCbQuery`, edit the message.

---

## Implementation order (recommended)

1. **F5 /session** — 1h, no API uncertainty, immediate value
2. **Enhanced /status, /start, /help** — 1h, pure formatting, zero risk
3. **F2 /files** — 1–2h, verify tool part shape first
4. **F3 /agent** — 2h, depends on switch API verification
5. **F4 /model** — 2h, depends on config patch API verification
6. **F1 Streaming** — 3–4h, verify event shapes first, highest risk

For F3 and F4: **verify the mutation API before writing any switch code.**
Use `curl` or the opencode TUI's network tab to see exactly what request
the TUI sends when switching agent/model. Code only what you can verify.

---

## Definition of done

- [ ] `npm test` passes (all existing tests + new tests per feature)
- [ ] `npx tsc` compiles with no errors
- [ ] Live smoke test: each command shows the card design above
- [ ] Inline buttons work (tap → correct action → message updates)
- [ ] No regression on 14.3 (basic chat) and 14.9 (/abort)
- [ ] `setMyCommands` updated with all new commands
