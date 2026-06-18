# Design: pluggable agent backends (ACP + native), beyond opencode

> Status: **Draft / Proposed** · Date: 2026-06-17
> Scope: make OCRC drive coding agents other than opencode (Kimi, Gemini, Cursor,
> Codex, Claude Code) without rewriting the Telegram/Web UX.

## 1. TL;DR

- OCRC is today an **opencode plugin**: hosted in-process, handed `ctx.client`
  (the full opencode HTTP API) plus an event hook. The **card model and the
  Telegram/Web transports are already backend-agnostic**; everything else (relay,
  every web route, every Telegram handler, history/push) calls the opencode SDK
  directly. That direct coupling is the work.
- **ACP (Agent Client Protocol)** is a real, Zed-led standard ("LSP for coding
  agents"), JSON-RPC 2.0 over stdio, with an official TypeScript client SDK
  (`@agentclientprotocol/sdk`). It is **richer than first assumed**: multi-session
  per connection, capability negotiation, streaming text/thought/tool-calls,
  permissions, **standardized diffs, plans (todo), token/cost usage, and
  model/mode/config switching**.
- **One `AcpBackend` adapter covers many agents** (Kimi/Gemini natively; Cursor
  natively; Codex/Claude via maintained bridges) by just changing the spawn
  command. That is the high-leverage move — not a Kimi-specific integration.
- **But ACP is a lowest-common-denominator**: per-agent coverage varies, the
  Codex/Claude ACP paths are third-party bridges that *lag or filter* the native
  surface, and **no agent supports attaching to a live, concurrently-running TUI
  session** — they load idle/persisted sessions as an IDE subprocess. opencode's
  in-process plugin is the only backend that mirrors the *live* local session
  (and even it has a cross-workspace streaming limit — see
  `docs/decisions/2026-06-12-cross-workspace-streaming.md`).
- **Recommendation:** introduce an `AgentBackend` seam (refactor opencode behind
  it, zero behavior change), then add **one `AcpBackend`** (Kimi first). Treat
  native adapters (Codex `app-server`, Claude Agent SDK) as later, optional,
  higher-fidelity backends where ACP is too thin. Surface a **capability set** so
  the frontend degrades gracefully per backend.

## 2. Goals / non-goals

**Goals**
- Drive a second agent backend end-to-end (prompt → stream → tool cards →
  approvals) from the existing Telegram + Web UIs.
- Make the backend choice configuration, not a fork.
- Keep the opencode experience exactly as-is (it stays the highest-fidelity path).
- Let the UI adapt to what a given backend can/can't do.

**Non-goals (for v1)**
- Concurrent multi-driver of a single live session (no backend supports it).
- Full feature parity across backends (accept documented gaps).
- HTTP/WebSocket ACP transport (only stdio is stable today).
- Reproducing opencode-specific server features (workspace/project enumeration,
  cross-workspace catalog) on non-opencode backends.

## 3. How OCRC couples to opencode today

| Layer | File(s) | Coupling |
|---|---|---|
| Plugin entry / lifecycle | `src/plugin/entry.ts` | **opencode-specific.** `event()` hook, `ctx.client` (`OpencodeClient`), `ctx.serverUrl`, PRIMARY election, global SSE (`src/opencode/global-events.ts`). |
| Event → card relay | `src/core/relay.ts`, `src/core/opencode-events.ts` | **Tightly coupled.** Hardcodes opencode event names (`message.part.delta`, `message.part.updated`, `session.idle/error`, `permission.*`, `tui.session.select`) and message-part shapes. |
| Submit | `src/opencode/submit.ts` | `client.session.promptAsync()`. |
| History | `src/core/history.ts` | `messageToCards()` parses opencode message shape. |
| Push notifications | `src/core/push.ts` | opencode `session.idle/error` + test-failure heuristics. |
| Session list / summaries | `src/opencode/list-sessions.ts`, `src/transport/web/session-summary.ts`, `src/opencode/workspaces.ts` | opencode session fields, `project.list()`. |
| Web routes | `src/transport/web/routes/*` | **Each route calls the SDK directly** (`session.get/list/create/delete`, `config.get/providers`, permission approve, diff, todo). **Largest coupling surface.** |
| Telegram handlers | `src/transport/telegram/handlers.ts` (+ `handlers/info-commands.ts`) | Same direct SDK calls (status, config, diff, todo, command, create/update). |
| **Card model** | `src/core/structured-card.ts` | **Generic ✓** — `thinking/streaming/assistant/user/error/status/info/approval`, `ContentBlock = text | tool`. |
| **Transport interface** | `src/transport/interface.ts` | **Generic ✓** — `send/onMessage/onCommand/onButtonClick`. |
| Web frontend | `web/src/lib/api/client.ts` + components | Talks only to OCRC's own `/api/*` (already a layer of indirection), but the *set* of endpoints assumes opencode features. |

**Takeaway:** the seam belongs **below the relay and below the web routes /
Telegram handlers** — i.e. an `AgentBackend` interface that those layers call
instead of `OpencodeClient`. The card model + transport interface are reusable
as-is.

## 4. What ACP actually allows (the ceiling)

Primary source: `agentclientprotocol.com` + `@agentclientprotocol/sdk` (`ClientSideConnection`). Wire **protocol version `1`**, JSON-RPC 2.0 over stdio.

- **Handshake & capability negotiation** — `initialize` exchanges
  `protocolVersion`, **client capabilities** (`fs.readTextFile/writeTextFile`,
  `terminal`) and **agent capabilities** (`loadSession`, `promptCapabilities`,
  `sessionCapabilities.{resume,list,delete}`, `mcpCapabilities`). **Everything
  optional is opt-in via a capability key — this is exactly the signal OCRC needs
  to drive UI degradation.**
- **Sessions (multi-session per connection)** — `session/new` `{cwd, mcpServers}`
  → `{sessionId, modes?, configOptions?}`; `session/load` (replays history as
  `session/update`s), `session/resume` (no replay), `session/list` (paginated),
  `session/delete`. (Gated by capabilities.)
- **Prompt & stream** — `session/prompt {prompt: ContentBlock[]}`; agent streams
  `session/update` notifications then resolves with a `stopReason`
  (`end_turn|max_tokens|refusal|cancelled|…`). `session/update` variants:
  `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`,
  `tool_call`, `tool_call_update`, `plan`, `available_commands_update`,
  `current_mode_update`, `config_option_update`, `usage_update`.
- **Tool calls** — `tool_call`/`tool_call_update` carry `title`, `kind`
  (`read/edit/execute/…`), `status` (`pending→in_progress→completed|failed`),
  `locations[]`, and `content[]` including a **`diff` variant** (`path/oldText/newText`) and `terminal` embeds, plus `rawInput/rawOutput`.
- **Permissions** — `session/request_permission {toolCall, options[]}` where each
  option has `kind ∈ allow_once|allow_always|reject_once|reject_always`; client
  replies `{outcome: selected, optionId}` or `{cancelled}`. Maps cleanly to our
  `approval` card + inline buttons.
- **Model / mode / config (standardized)** — prefer `session/set_config_option`
  (categories `model|mode|thought_level|…`, returns full state); `session/set_mode`
  is the older API. Agent-initiated changes arrive as `config_option_update` /
  `current_mode_update`.
- **Usage (standardized)** — `usage_update {used, size, cost?}` → powers our
  assistant-card token/cost meta.
- **Reverse-RPC to the client (capability-gated)** — `fs/read_text_file`,
  `fs/write_text_file`, `terminal/*`. OCRC decides whether to advertise these
  (routing the agent's file/shell I/O through our process = sandboxing/visibility,
  vs. letting the agent do its own I/O).
- **Cancel** — `session/cancel` (notification).
- **Out of scope** — workspace/project enumeration; git (branches/commits) beyond
  the generic diff. Extensible via `_meta` / `_`-prefixed keys.

**Net:** ACP can express ~90% of OCRC's card model. The gaps are
opencode-server niceties (project/workspace catalog) and *per-agent* coverage.

## 5. Per-agent feasibility (from official docs)

| Agent | ACP | Launch | `list` | `resume` | thought stream | tool diffs | model switch | usage | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Kimi Code CLI** | **native** | `kimi acp` | ✅ | ✅ | ❓ undoc | ❓ undoc | ✅ `set_mode`/`set_config_option` | ❓ | Strongest native ACP target. Terminal RPC not wired; audio dropped. npm `kimi-code`, Node ≥24.15. Auth: `kimi /login` first. |
| **Gemini CLI** | native | `gemini --acp` | ❌ none | `loadSession` | ❌ bug #20977 | ✅ `tool_call` | `unstable_setSessionModel` | — | No session listing; subprocess auth is flaky; v0.18+ subprocess regression to verify. npm `@google/gemini-cli`, Node ≥20. |
| **Cursor CLI** | native (hidden) | `agent acp` | ❓ undoc | `session/load` | ❓ | ❓ | not over ACP | — | **Native `-p --output-format stream-json` is better documented.** Self-contained binary (no Node). Community ACP adapters archived. |
| **Codex CLI** | **bridge only** | `npx @zed-industries/codex-acp` | ❌ **absent** | folds into `load` | ✅ reasoning | ✅ | `setModel`/`setMode` | ✅ tokens | **Native `codex app-server` (thread/* + turn/*) is much richer** (`thread/list/resume/fork`, token usage). Bridge is Rust, active (Zed). |
| **Claude Code** | **adapter only** | `npx @agentclientprotocol/claude-agent-acp` | ✅ `listSessions` | ✅ (+`unstable_fork`) | ❌ **thinking dropped** | ✅ | session config | ✅ | Adapter active (v0.46, agentclientprotocol org), wraps Claude Agent SDK. **Native SDK / `claude -p stream-json` richer.** Subscription login restricted → API key. |

**Two structural facts that shape the design:**

1. **ACP is a subset for Codex & Claude.** Their *native* protocols
   (`codex app-server`, `@anthropic-ai/claude-agent-sdk`) expose `list/resume/fork`
   + token usage + reasoning that the ACP bridges omit or filter. If we want a
   first-class Codex/Claude experience, native adapters beat ACP. If we want *one
   protocol for many agents fast*, ACP is the move and Codex/Claude come along for
   free at reduced fidelity.
2. **No live-TUI attach anywhere.** Every ACP/native-headless path runs the agent
   as a subprocess driving idle/persisted sessions. The opencode-style "see what
   I'm doing in my local TUI on my phone, then take over" is **unique to the
   in-process opencode plugin** and does not generalize.

## 6. The seam: `AgentBackend`

A single interface that the relay, web routes, and Telegram handlers depend on
instead of `OpencodeClient`. Each backend reports a **capability set**; the UI
reads it to decide what to render.

```ts
// src/core/agent/backend.ts  (new)
export interface AgentBackend {
  readonly id: string                 // 'opencode' | 'acp:kimi' | 'codex' | ...
  readonly capabilities: BackendCapabilities

  // lifecycle
  start(): Promise<void>
  stop(): Promise<void>

  // events → normalized stream the relay consumes (NOT opencode-shaped)
  onEvent(handler: (e: AgentEvent) => void): () => void

  // sessions
  listSessions?(dir?: string): Promise<SessionSummary[]>   // gated by cap.list
  createSession(opts: { directory?: string; title?: string }): Promise<{ id: string }>
  loadHistory(id: string): Promise<StructuredCard[]>       // load/resume + normalize
  deleteSession?(id: string): Promise<void>

  // turn
  prompt(id: string, blocks: PromptBlock[]): Promise<void>
  cancel(id: string): Promise<void>

  // config
  getConfigOptions?(id: string): Promise<ConfigOption[]>   // model/mode/thought
  setConfigOption?(id: string, configId: string, value: string): Promise<void>

  // permissions
  resolvePermission(id: string, requestId: string, optionId: string | 'cancel'): Promise<void>

  // optional extras (present only if cap says so)
  diff?(id: string): Promise<FileDiff[]>
  plan?(id: string): Promise<PlanEntry[]>
}

export interface BackendCapabilities {
  listSessions: boolean
  resumeSession: boolean
  history: boolean          // can replay past turns
  thinkingStream: boolean   // agent_thought_chunk
  toolDiffs: boolean
  modelSwitch: boolean      // set_config_option / set_model
  usageMeta: boolean        // tokens/cost
  approvals: boolean        // request_permission
  slashCommands: boolean    // available_commands_update
  workspaces: boolean       // project enumeration (opencode-only)
  liveMirror: boolean       // attach to a concurrently-running local session (opencode-only)
}
```

**Normalized event** the relay consumes (maps 1:1 from ACP `session/update` and
from opencode events):

```ts
type AgentEvent =
  | { type: 'message.delta'; sessionId; messageId; text; thinking?: boolean }
  | { type: 'tool.update'; sessionId; toolId; title; kind; status; diff?; output? }
  | { type: 'plan'; sessionId; entries: PlanEntry[] }
  | { type: 'permission.asked'; sessionId; requestId; toolCall; options }
  | { type: 'config.update'; sessionId; options: ConfigOption[] }
  | { type: 'usage'; sessionId; used; size; cost? }
  | { type: 'turn.end'; sessionId; stopReason }
  | { type: 'session.error'; sessionId; message }
```

The relay's existing job — accumulate deltas into a streaming card, finalize on
turn end, rotate the card on permission — stays, but keyed off `AgentEvent`
rather than opencode's `OcEvent`. `opencode-events.ts` becomes the
**opencode→AgentEvent normalizer**; a new `acp-events.ts` does ACP→AgentEvent.

## 7. Backends

1. **`OpencodeBackend`** (refactor of today's code). Wraps `OpencodeClient` + the
   plugin `event` hook. `capabilities`: everything true, incl. `workspaces` and
   **`liveMirror: true`** (the differentiator). No behavior change for users.
2. **`AcpBackend`** (new, the payoff). Spawns a configured command, speaks ACP via
   `@agentclientprotocol/sdk` `ClientSideConnection`. One implementation, many
   agents:
   ```
   OCRC_BACKEND=acp
   OCRC_ACP_CMD="kimi acp"            # or "gemini --acp", "agent acp",
                                       # "npx @zed-industries/codex-acp",
                                       # "npx @agentclientprotocol/claude-agent-acp"
   ```
   Capabilities filled from the `initialize` response (don't hardcode per agent).
   Implements our `Client` side: `requestPermission`, optional `fs/*` and
   `terminal/*` (advertise deliberately — see §4).
3. **Native adapters (later, optional)** where ACP is too thin:
   - `CodexAppServerBackend` — `codex app-server` (`thread/list/resume/fork`,
     token usage). Higher fidelity than `codex-acp`.
   - `ClaudeAgentBackend` — `@anthropic-ai/claude-agent-sdk` (in-process, keeps
     thinking stream + cost that the ACP adapter drops).

## 8. Backend impact (what changes server-side)

| Change | Files | Size |
|---|---|---|
| New `AgentBackend` interface + normalized `AgentEvent` + capability set | `src/core/agent/*` (new) | M |
| Relay keyed off `AgentEvent` (not `OcEvent`) | `src/core/relay.ts`, `src/core/opencode-events.ts`→normalizer, new `acp-events.ts` | M |
| `OpencodeBackend` wrapping current SDK/plugin code | `src/core/agent/opencode-backend.ts` (move logic from entry/submit/history/push) | M |
| `AcpBackend` (spawn + `ClientSideConnection` + normalize) | `src/core/agent/acp-backend.ts` (new) | **L** |
| Web routes call `backend.*` not `client.*` | `src/transport/web/routes/*`, `session-summary.ts` | **L** (many small edits) |
| Telegram handlers call `backend.*` | `src/transport/telegram/handlers*.ts` | M |
| History/push via backend | `src/core/history.ts`, `src/core/push.ts` | M |
| **Host runtime for non-plugin backends** | new `src/host/*` | M |

**Runtime / hosting.** opencode loads OCRC as an in-process plugin and hands it
`ctx`. ACP/native backends invert this: **OCRC must run as a standalone process**
that *spawns the agent* as a child and talks JSON-RPC over its stdio. So:
- Keep the plugin entry for `OpencodeBackend`.
- Add a **standalone host** (`ocrc serve --backend acp`) that boots the same
  transports (Telegram/Web) but with an `AcpBackend`. PRIMARY-election and the
  global-SSE plumbing are opencode-only and don't apply to the host.
- The Bun-vs-Node concern **disappears** for ACP — we only need to pipe JSON-RPC
  to a child process; OCRC's own runtime is free to stay Bun/Node.

**Auth.** Per agent, out of band: `kimi /login`, `gemini` OAuth/`GEMINI_API_KEY`,
`cursor login`/`CURSOR_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. The host
passes the right env into the spawned child; Claude/Gemini subscription-login as a
subprocess is unreliable → document "use an API key for non-opencode backends."

## 9. Frontend impact (web PWA + Telegram)

The web frontend already talks only to OCRC's `/api/*`, so the contract is ours to
shape. The change is **capability-driven rendering**, not a rewrite.

- **New `GET /api/capabilities`** (or fold into `/api/me`) returns
  `BackendCapabilities` + `backend.id`. The web app fetches it on load and gates UI.
- **Session rail** (`web/src/lib/components/SessionList.svelte`, `SessionRail`): if
  `!listSessions` (Gemini, maybe Cursor), hide the list and show a single active
  session + "new session"; deep-link by id still works.
- **Model/agent chip** (`AgentModelChip.svelte`, `/api/models`,`/api/overrides`):
  drive from `config_option_update` (categories `model`/`mode`/`thought_level`);
  if `!modelSwitch`, hide the chip. opencode's agent/model stays as-is.
- **Inspector** (`Inspector.svelte`, `/api/session/:id/diff`,`/todo`,`/context`):
  - Diff tab ← `tool_call` `diff` content (cap `toolDiffs`); else hide.
  - Todo tab ← `plan` updates (cap from `plan` events); else hide.
  - Context/cost ← `usage_update` (cap `usageMeta`); opencode keeps full meta.
  - MCP/workspaces panels are opencode-only (`cap.workspaces`).
- **Approvals** (`CardApproval.svelte`): render the agent-supplied
  `options[]`→buttons (variable, not fixed once/always/reject); reply `optionId`.
- **Thinking stream**: hide the think card when `!thinkingStream` (Gemini, Claude
  ACP).
- **Command palette** (`CommandPalette.svelte`, `/api/commands`): source from
  `available_commands_update` when present; else just session search.
- **Telegram**: gate commands by capability (`/model`,`/files`,`/diff` hidden when
  unsupported); `/status` shows `backend.id`. Approvals already use inline buttons
  — feed them the ACP option set.

**Frontend effort:** Medium. Mostly conditional rendering behind capability flags
+ one new endpoint. The card stream, WS hub, and rendering are unchanged.

## 10. Capability degradation matrix (what the user actually gets)

| Feature | opencode | Kimi (ACP) | Gemini (ACP) | Cursor (ACP/native) | Codex (ACP bridge / app-server) | Claude (ACP / SDK) |
|---|---|---|---|---|---|---|
| Prompt + stream | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tool cards + diffs | ✅ | ◐ undoc | ✅ | ◐ | ✅ | ✅ |
| Thinking stream | ✅ | ◐ undoc | ❌ | ◐ | ✅ / ✅ | ❌ / ✅ |
| Approvals | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session list | ✅ | ✅ | ❌ | ◐ | ❌ / ✅ | ✅ |
| Resume history | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ |
| Model/mode switch | ✅ | ✅ | ◐ unstable | native only | ✅ | ✅ |
| Tokens / cost | ✅ | ◐ | ❌ | ❌ | ✅ | ◐ / ✅ |
| Todo / plan | ✅ | ◐ | ◐ | native | ◐ / ✅ | ✅ |
| Workspaces catalog | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Live local-session mirror** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

✅ supported · ◐ partial/undocumented/native-only · ❌ not available

## 11. The tradeoff to be explicit about

opencode integration's *signature* feature is the **live shared session**: the
phone mirrors the exact session you're running locally, and you can hand off. **No
ACP/native-headless backend reproduces this** — they all spawn the agent and load
*idle/persisted* sessions. So a second backend buys **broad reach** (remote
prompting, streaming, approvals across the whole agent ecosystem) but **not the
hand-off magic**. If hand-off is the product's core, opencode stays first-class and
ACP is the "also drive these" tier — which is exactly how the capability set frames
it (`liveMirror: true` only for opencode).

(Caveat: opencode's live mirror itself is limited to the plugin's own directory —
cross-workspace streaming is unsupported, see the 2026-06-12 ADR. So "live mirror"
is opencode-only *and* single-workspace.)

## 12. Phasing

1. ✅ **Seam, no behavior change.** Extract `AgentBackend`; implement
   `OpencodeBackend` wrapping today's code; relay/routes/handlers call the
   interface. *Shipped — the de-risking step, independently valuable.*
   Plus the event seam (`AgentEvent` + opencode/acp normalizers) so the relay is
   backend-agnostic on the event path too.
2. **`AcpBackend` + standalone host, Kimi first.**
   - ✅ `AcpBackend` (`acp-backend.ts`) + `connectAcp` (`acp-connect.ts`) +
     `acp-normalizer.ts`; `AgentBackend.onEvent` for stream-owning backends.
   - ✅ Standalone host (`oprc host`, `src/cli/host.ts`) — runs OCRC against a
     spawned ACP agent with no opencode; `OCRC_ACP_CMD` config.
   - ✅ Validated live against `kimi acp`: `initialize → session/new → prompt →
     stream → request_permission → end_turn`, end-to-end through the web transport.
   - ✅ `/api/capabilities` + frontend gating. Expanded `BackendCapabilities`
     beyond `liveMirror`/`tuiSelect` to feature flags (`workspaces`/`diff`/
     `todos`/`catalog`/`mcp`/`commands`); web gates affordances via a `can()`
     store helper and degrades cleanly on ACP (incl. fixing session creation
     with no workspaces).
   - ✅ Inline permission-approval wiring. The host surfaces ACP permission
     requests through the existing Telegram buttons + Web approval card
     (`handlePluginPermissionEvent`); decisions route to `resolvePermission` →
     ACP optionId. Interactive by default; `OCRC_ACP_AUTO_APPROVE=true` for
     unattended. Live-validated against kimi.

   **Phase 2 complete** — OCRC runs end-to-end against a spawned ACP agent
   (kimi) with no opencode: streaming, sessions, capability-gated UI, and
   permission approval all validated live.
3. **Breadth.** Flip `OCRC_ACP_CMD` to Gemini/Cursor; handle their gaps via
   capabilities (no code per agent).
4. **Native high-fidelity (optional).** `CodexAppServerBackend`,
   `ClaudeAgentBackend` where ACP is too thin.

## 12b. Validated against live `kimi acp` (2026-06-18)

Probed `kimi acp` (Kimi Code CLI 1.47.0, `@agentclientprotocol/sdk` 0.26.0,
`PROTOCOL_VERSION=1`). Full `initialize → session/new → prompt → stream →
request_permission → end_turn` round-trip works **while logged in**.

**`initialize` reports:** `loadSession:true`, `sessionCapabilities.list/resume`,
`promptCapabilities.{embeddedContext:true, image:true, audio:false}`,
`mcpCapabilities.http:true`. Also advertises `authMethods:[{id:'login', terminal-auth: kimi login}]`.
**Key finding: advertised `authMethods` ≠ auth required** — `session/new` succeeds
without `authenticate` when credentials already exist. So the client must *attempt*
`newSession` and only fall back to `authenticate({methodId})` on an auth error,
not gate on `authMethods.length`.

**`sessionUpdate` → `AgentEvent` mapping (observed payloads):**

| ACP `sessionUpdate` | payload | → AgentEvent |
|---|---|---|
| `agent_message_chunk` | `{content:{type:'text',text}}` — **no part id** | text |
| `agent_thought_chunk` | `{content:{type:'text',text}}` — **no part id** | reasoning |
| `tool_call` | `{toolCallId, title:"Shell", status:'in_progress', content:[{content:{type:'text',text},type:'content'}]}` | tool (running) |
| `tool_call_update` | same shape, status transitions | tool status |
| `available_commands_update` | `{availableCommands:[{name,description}]}` | → `listCommands`, **not** a relay event |
| `prompt` result | `{stopReason:'end_turn'}` | `idle` |

**`requestPermission` (client method, not a sessionUpdate):**
`{sessionId, toolCall:{toolCallId, title:"Shell: echo hello-acp", content:[…]}, options:[{optionId:'approve',kind:'allow_once'},{optionId:'approve_for_session',kind:'allow_always'},{optionId:'reject',kind:'reject_once'}]}`.
Return `{outcome:{outcome:'selected', optionId}}`.

**Two seam-impedance points the AcpBackend normalizer must absorb:**
1. **No part ids on text/thought chunks** (opencode parts carry ids). The
   normalizer must synthesize a stable per-turn part id per kind (text vs
   reasoning) and reset it on `idle`, emitting `{kind:'part'}` on first chunk
   then `{kind:'delta'}` thereafter. Tool chunks *do* carry `toolCallId` → use directly.
2. **Permission model differs** — ACP uses `optionId`+`kind`
   (`allow_once`/`allow_always`/`reject_once`); opencode uses its own permission
   ids. The backend's `resolvePermission` maps OCRC's allow/deny → an ACP `optionId`
   by `kind`.

## 13. Risks & open questions

- **Per-agent ACP coverage is uneven and partly undocumented** (Kimi's
  thought/tool/plan variants; Cursor's chunk subtypes). Mitigation: capability
  negotiation + defensive normalization; verify each against a live handshake
  before claiming support.
- **Third-party bridges (Codex/Claude) lag native** and add a trust hop. Prefer
  native adapters if those agents matter.
- **Subprocess auth** (Gemini/Claude subscription login) is flaky headless →
  require API keys for non-opencode backends.
- **SDK is pre-1.0** (`@agentclientprotocol/sdk` 0.26.x) — pin and re-verify types.
- **Effort is front-loaded** in the route/handler decoupling (many small edits),
  not the ACP client itself (the SDK does the heavy lifting).

## 14. Recommendation

Do **Phase 1 (the seam) regardless** — it pays for itself in testability and is the
prerequisite for both multi-agent *and* the backlog's "abstract transport layer"
item. Then ship **`AcpBackend` with Kimi** as the first non-opencode backend; let
Gemini/Cursor follow for free. Keep opencode as the flagship (live mirror, full
meta). Only invest in native Codex/Claude adapters if those specific agents become
a priority — ACP gets them working first at reduced fidelity.

---

### Appendix: sources

ACP: [agentclientprotocol.com](https://agentclientprotocol.com/get-started/introduction) ·
[spec repo](https://github.com/agentclientprotocol/agent-client-protocol) ·
npm `@agentclientprotocol/sdk`.
Kimi: [kimi-acp reference](https://moonshotai.github.io/kimi-code/en/reference/kimi-acp).
Gemini: [acp-mode docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md).
Cursor: [cli/headless](https://cursor.com/docs/cli/headless), [cli/using](https://cursor.com/docs/cli/using).
Codex: [app-server](https://developers.openai.com/codex/app-server), [SDK](https://developers.openai.com/codex/sdk), bridge [zed-industries/codex-acp](https://zed.dev/acp/agent/codex-cli).
Claude: [headless](https://code.claude.com/docs/en/headless), adapter `@agentclientprotocol/claude-agent-acp`.
