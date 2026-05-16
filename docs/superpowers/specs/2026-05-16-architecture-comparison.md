# Architecture Comparison — Plan A (Hybrid Plugin) vs Plan B (External Bot)

> Decision document. Pick one path; Phase 3 / Phase 4 specs get rewritten
> to match.

## Background — May 2026 ecosystem snapshot

Direct competitors we are entering against:

| Category | Top project | Stars | Pattern |
|---|---|---|---|
| Multi-agent × multi-channel bridge | **chenhg5/cc-connect** | **9,400** | Go binary, ACP subprocess, embedded admin UI; 5+ agents × 7+ channels |
| Web UI / multi-surface | **btriapitsyn/openchamber** | **4,300** | Web + Desktop (Tauri) + VS Code + Terminal |
| Claude Code Telegram bot | **RichardAtCT/claude-code-telegram** | **2,600** | Python daemon, `claude-agent-sdk` primary + CLI fallback |
| Opencode Telegram bot | grinev/opencode-telegram-bot | 643 | TS daemon, grammy, HTTP→opencode :4096, `npx` install |
| Web alt | kcrommett/opencode-web | 65 | TanStack Start + React, hand-rolled HTTP |
| Slack-focused | Wangmerlyn/vibe-coding-slack-notifier | small | External CLI + plugin hook wrapper |
| Slack/Discord template | kortix-ai/opencode-channels | 14 | Vercel Chat SDK + Hono webhooks |

**Pattern across the field:** all chat-bot projects are external processes that
consume the opencode HTTP server. No one is using a pure plugin architecture
for chat integration because plugins are event-hook-only, not designed for
long-lived network connections.

## What the SDK and Plugin docs actually say

Sources:
- https://opencode.ai/docs/sdk/ — full SDK API surface
- https://opencode.ai/docs/plugins/ — plugin lifecycle and hooks
- Existing plugins (background-agents, vibe-coding-slack-notifier) — real-world patterns

### SDK recommendations

The official SDK pattern for sending a message is:

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk'
const client = createOpencodeClient({ baseUrl: 'http://localhost:4096' })

await client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: 'text', text: 'Your prompt' }],
    agent: 'build',                                         // per-message override
    model: { providerID: 'kimi-for-coding', modelID: 'k2p6' }, // per-message override
    noReply: false,                                         // true = context only
    format: { type: 'json_schema', schema: { ... } },       // structured output
  }
})
```

Our current code uses `/tui/select-session → /tui/clear-prompt → /tui/append-prompt
→ /tui/submit-prompt`. **This is a TUI control path, not the recommended
message submission path.** The TUI inject lets messages appear in the user's
TUI window, but loses per-message `agent`/`model` override — which is exactly
why our `/agent` and `/model` are crippled.

### Plugin docs reality

Plugins are loaded at startup, hook into events, and return a hooks object.
What plugins **can** do:
- Subscribe to events: `session.idle`, `session.created`, `message.part.updated`,
  `tool.execute.before/after`, `permission.asked`, etc.
- Register custom tools the agent can call
- Modify shell env via `shell.env`
- Use `$` (Bun shell) for command execution
- Call `client.app.log()` for structured logging

What plugins **don't natively do** (confirmed by docs absence + competitor patterns):
- Run long-lived background processes (polling Telegram, holding WebSocket)
- Serve HTTP endpoints (for Web UI)
- Maintain persistent network connections

**Real-world workaround:** plugin-based projects either spawn external processes
(opencode-background-agents) or pair with a CLI/sidecar (vibe-coding-slack-notifier).
No one runs a pure plugin Telegram bot.

---

## Plan A — Hybrid Plugin + Sidecar

### Architecture

```
┌─────────────────────────────────┐      ┌─────────────────────────────┐
│        opencode process          │      │      sidecar process         │
│                                  │      │                              │
│  ┌──────────────────────────┐    │      │  ┌────────────────────┐     │
│  │ opencode core            │    │      │  │ Telegram bot       │     │
│  │ ├─ TUI                   │    │      │  │ (telegraf/grammy)  │     │
│  │ ├─ HTTP server :4096     │◄───┼──────┼──┤                    │     │
│  │ └─ Plugin runtime        │    │      │  │ Web server         │     │
│  │    └─ our-plugin/        │────┼──────┼─►│ (express/hono)     │     │
│  │       events.ts hooks    │    │      │  │                    │     │
│  └──────────────────────────┘    │      │  └────────────────────┘     │
└─────────────────────────────────┘      └─────────────────────────────┘
                                              │
                                              ▼
                                          Telegram cloud
                                          Web browser
```

- **Plugin**: small npm package added to user's `opencode.json`. Hooks
  `message.part.updated`, `session.idle`, `permission.asked`, `tool.execute.before`.
  Pushes events to sidecar over loopback HTTP (or Unix socket).
- **Sidecar**: standalone Node service. Owns Telegram bot, Web UI server.
  Calls `client.session.prompt()` for new messages. Uses event stream from
  plugin (or falls back to SSE if plugin missing).

### Dependencies (Plan A)

| Layer | Deps |
|---|---|
| Plugin | `@opencode-ai/sdk` (peer), zero runtime deps if possible |
| Sidecar | `@opencode-ai/sdk`, `telegraf` or `grammy`, `express`/`hono`, `ws`, `zod`, `dotenv` |
| Build | `typescript`, `vitest`, `esbuild` or `tsc` |
| Install | published as TWO npm packages: `@your-handle/opencode-rc-plugin` and `@your-handle/opencode-rc` |

### Install story (Plan A)

```bash
# Plugin: edit opencode.json
{ "plugin": ["@your-handle/opencode-rc-plugin"] }

# Sidecar: install + run
npx @your-handle/opencode-rc init        # interactive setup
npx @your-handle/opencode-rc start       # or as launchd service

# OR: combine into one command
npx @your-handle/opencode-rc full-install   # writes plugin entry + starts sidecar
```

Plus opencode itself must be running. So **2 processes always**: opencode + sidecar.
(TUI is optional — sidecar can spawn opencode serve if needed.)

### Pros (Plan A)

1. **Custom tool registration** — the agent can call `ask_user_telegram(question)`
   as a tool. Real interactive Q&A from inside the agent.
2. **Pre-LLM event interception** — plugin can rewrite messages before model
   sees them (e.g., inject user's TZ as context).
3. **Tool execution observation** — hook `tool.execute.before/after` to render
   richer cards than what SSE deltas give (we already get most of this via SSE,
   but with tool hooks we can also see the *decision* to call the tool).
4. **Aligned with opencode's extension model** — community-natural.

### Cons (Plan A)

1. **Plugin API is underdocumented and may change** — docs don't even cover
   long-lived process behavior. We'd be relying on implementation details.
2. **Two artifacts, more install friction** — plugin npm + sidecar npm.
   `npx ... full-install` mitigates but still adds complexity.
3. **No precedent in opencode bot ecosystem** — every chat-bot competitor
   chose pure external (Plan B). We'd be the only ones taking on this risk.
4. **Plugin runs inside opencode lifecycle** — if plugin crashes during init,
   it might prevent opencode from starting. Sidecar crash is recoverable.
5. **Plugin-sidecar IPC is extra surface** — bugs in protocol design,
   versioning between the two packages.
6. **Marginal benefit for chat use case** — tool registration is nice but
   most user value is in messages flowing through, which SSE already provides.

### Risk-feasibility verdict (Plan A)

**Technically feasible but architecturally aspirational.** The pure-plugin
benefits (custom tools, pre-LLM interception) are real but tangential to the
core "remote control via chat" use case. The cost (two artifacts, unstable
plugin API, no precedent) outweighs the benefits for a v1.0 OSS project.

Recommendation: keep Plan A in mind as a future enhancement if a specific
feature truly needs plugin-level hooks. **Not as the v1.0 architecture.**

---

## Plan B — External Bot + Web, aligned with SDK

### Architecture

```
┌──────────────────────────┐     ┌──────────────────────────────────┐
│   opencode process       │     │      our process (single)         │
│                          │     │                                   │
│  ┌────────────────────┐  │     │  ┌─────────────────────────────┐ │
│  │ HTTP server :4096  │◄─┼─────┼──┤ core/                       │ │
│  │ - /session/*       │  │     │  │   - SDK client               │ │
│  │ - /event           │  │     │  │   - Event stream consumer    │ │
│  │ - /tui/*           │  │     │  │   - Relay (chat loop)        │ │
│  └────────────────────┘  │     │  │   - State persistence        │ │
│                          │     │  └────────┬────────────────────┘ │
└──────────────────────────┘     │           │                       │
                                 │     ┌─────┴──────┬──────────────┐ │
                                 │     ▼            ▼              ▼ │
                                 │ ┌────────┐ ┌────────┐ ┌──────────┐│
                                 │ │transport│ │transport│ │transport││
                                 │ │/telegram│ │/web    │ │/discord ││
                                 │ │         │ │ (PWA)  │ │  (later)││
                                 │ └────────┘ └────────┘ └──────────┘│
                                 └──────────────────────────────────┘
```

- **One process** consumes opencode HTTP + SSE.
- **Transport abstraction** in `src/transport/`: telegram, web (PWA serving),
  later discord/feishu/slack.
- **SDK-native message submission** via `client.session.prompt()` —
  per-message agent/model overrides work naturally.
- **TUI inject path retained as opt-in** — for users who want messages to
  also show in their Mac TUI, route through TUI inject; otherwise default to
  `session.prompt()`.

### Dependencies (Plan B)

| Layer | Deps |
|---|---|
| Core | `@opencode-ai/sdk`, `zod`, `dotenv`, well-formed types |
| Telegram | `telegraf` (keep — works fine) or migrate to `grammy` (more active) |
| Web | `hono` (lightweight server), `ws` (WebSocket), Svelte 5 + SvelteKit OR React Vite |
| Build | `typescript`, `vitest`, `tsx`/`esbuild` |
| Install | published as ONE npm package: `@your-handle/opencode-remote-control` |

### Install story (Plan B)

```bash
# Single npm package
npx opencode-remote-control init          # interactive: ask transports + tokens
npx opencode-remote-control start         # foreground
npx opencode-remote-control install-svc   # launchd/systemd registration
```

Plus opencode itself running. So **2 processes always**: opencode + ours.

### Pros (Plan B)

1. **One artifact** — one npm package, one install path.
2. **Aligned with every chat-bot competitor** — proven pattern.
3. **SDK-recommended** — uses `session.prompt()` with proper `agent`/`model`
   per-message override, fixes our /agent and /model crippling.
4. **Transport abstraction is real** — Web + Telegram + (future) Discord all
   share the same relay + state.
5. **Lower risk** — no dependency on undocumented plugin runtime behavior.
6. **Sidecar crash doesn't affect opencode** — clean process separation.
7. **OpenChamber-style multi-surface possible** — same core can serve web,
   desktop wrap (Tauri), VS Code extension (long-term).

### Cons (Plan B)

1. **No custom tool registration** — can't add `ask_user_via_telegram` as an
   agent tool. (Workaround: out-of-band "human in the loop" via approval-style
   cards, which we already have.)
2. **No pre-LLM message rewriting** — can only see events post-emit.
3. **SSE only** — can't observe intra-session state changes that aren't
   broadcast as events (verified: all the events we need are broadcast).
4. **Still needs TUI inject as opt-in** — if users want TUI visibility.
   Adds code complexity (two submission paths).

### Risk-feasibility verdict (Plan B)

**High feasibility, low risk, proven pattern.** Every successful opencode
chat-bot does this. SDK-native makes the architecture cleaner than grinev's
(which we know uses HTTP polling too).

---

## Decision matrix

| Criterion | Plan A (Hybrid) | Plan B (External) | Notes |
|---|---|---|---|
| Install simplicity | Medium (2 packages, plugin config) | High (1 package) | Plan B wins |
| Time-to-first-message | Slower (plugin init + sidecar IPC) | Faster (direct SDK) | Plan B wins |
| SDK alignment | High at sidecar boundary, custom at plugin | High end-to-end | Plan B cleaner |
| Custom tools support | Yes (via plugin) | No | Plan A wins |
| Tool execution observability | Plugin hooks (richer) | SSE deltas (sufficient) | Marginal |
| Plugin API stability risk | High (underdocumented) | None (uses HTTP) | Plan B safer |
| Match competitor patterns | None do this | All do this | Plan B proven |
| Web UI feasibility | Same | Same | Tie |
| Multi-transport extensibility | Same | Same | Tie |
| Total dependencies count | Higher (plugin + sidecar libs) | Lower | Plan B leaner |
| Code volume estimate | ~30% more | Baseline | Plan B smaller |
| Ability to ship v0.3.0-rc fast | Slower (untested plugin path) | Faster | Plan B wins |

**Score: Plan B wins on 9 of 12 criteria. Plan A wins on 1 (custom tools);
2 ties.**

---

## Recommended path: Plan B with strategic differentiation

### Differentiating positioning vs grinev/OpenChamber

We are **not** trying to beat grinev on Telegram features (642 stars head start,
voice/scheduled tasks/etc). We are **not** trying to beat OpenChamber on web/
desktop/VS Code breadth (4.3k stars, Tauri+VSCode).

**Our differentiation:**
- **SDK-native reference implementation** — show the community how to build
  on opencode SDK *correctly*. Code is the value, not the user count.
- **Single codebase for Telegram + Web** — most projects pick one. Show both
  delivered cleanly.
- **Transport abstraction as a library** — eventually publish
  `@your-handle/opencode-transport` so others build channels on top.

This positioning means we don't need to match grinev's voice+scheduled-tasks+6
locales. Those are features driven by their user base; ours can be lighter.

### Concrete revised plan (replaces Phase 3 + Phase 4 as written)

**Phase 3 (revised) — 2 weeks**
- Migrate message submission to `client.session.prompt()` (SDK-native);
  retain TUI inject as `TUI_VISIBLE=true` opt-in
- /agent and /model become per-message override (set in bot memory, applied
  to next `session.prompt`) — finally functional, not workarounds
- Transport abstraction (Card / Button / capabilities) — minimal, Web-aware
- core/relay.ts extraction
- Persistent lastSessionId (file-backed state)
- OSS prep: LICENSE, README, ARCHITECTURE.md, CI

**Phase 4 (revised) — 2-3 weeks**
- Productization: single `npx opencode-remote-control start` launcher
- Information parity: /diff, /todo, /context, inline tool-call rendering,
  push notifications
- TUI two-way sync: subscribe events for selected session + agent
- Tag v0.4.0-rc.1

**Phase 5 (new) — 4 weeks**
- Web transport: PWA, WebSocket, QR pairing auth
- Same single process serves /ws + /api + /
- Tag v0.5.0

This deletes Discord/Feishu/Slack from the v1.0 roadmap (not differentiating
against cc-connect / chat-bridge / channels). Add later if traction justifies.

### Open question for user

Before rewriting Phase 3 / Phase 4 / Phase 5 specs, confirm:

1. **Plan B with differentiation** (recommended)?
2. **Plan A hybrid** anyway, accepting higher risk for custom-tool capability?
3. **Stop OSS pursuit** — keep as personal tool, no public release?
