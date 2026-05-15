# Roadmap — opencode-remote-control (Open Source)

## Vision

Multi-channel sidecar for opencode remote control. Send a message from anywhere
(Telegram, Discord, Feishu, browser) → it lands in your local opencode session.

> One opencode server. Many remotes. Your terminal, anywhere.

## Positioning

- **What it is**: a relay between chat apps and a self-hosted opencode TUI.
- **What it is NOT**: a hosted SaaS, a coding agent, a TUI replacement.
- **Target user**: a developer who wants to keep coding with their AI while away from their keyboard.
- **Distribution model**: each user runs their own bot. Zero infra cost to maintainers.

---

## Milestones

### M0 — Now (2026-05-15)
- Phase 1 MVP shipped (Telegram, single user, launchd-managed)
- Phase 2 spec ready (sprint-002.md), not yet executed
- Personal use only, no public repo

### M1 — Ship Phase 2 (2 weeks)
**Goal:** All Phase 2 commands work, card UX is consistent, streaming output stable.

Deliverables:
- Card-style cards for `/status`, `/start`, `/help`, `/sessions`, `/current`
- New: `/session`, `/files`, `/agent`, `/model`
- Streaming output (real-time message edits)
- Tag `v0.2.0`

Exit criteria: Phase 2 acceptance tests pass on user's daily-driver setup.

---

### M2 — Open source prep (3–4 weeks)
**Goal:** codebase + docs ready for public release.

#### Architecture refactor
Split `bot/` into transport-agnostic core + transport-specific implementations:

```
src/
  core/                      ← channel-agnostic
    session-relay.ts         (handleChat logic, abstracted)
    tui-bridge.ts            (unchanged)
    event-stream.ts          (unchanged)
    types.ts                 (IncomingMessage, OutgoingMessage, Button, Card)
  transport/
    interface.ts             (Transport, MessageContext)
    telegram/                (moves current src/bot/* here)
  config.ts                  (TRANSPORT=telegram|discord|...)
  index.ts                   (loader: import transport by env)
```

`Transport` interface (minimal viable contract):
```typescript
interface Transport {
  start(): Promise<void>
  stop(): Promise<void>
  send(chatId: string, card: Card): Promise<{ messageId: string }>
  edit(chatId: string, messageId: string, card: Card): Promise<void>
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  onCommand(cmd: string, handler: (ctx: CommandContext) => Promise<void>): void
  onButtonClick(handler: (data: string, ctx: CommandContext) => Promise<void>): void
}
```
`Card` is a transport-agnostic structure (title, lines, buttons[]) that each
transport renders natively (Telegram HTML + inline keyboard; Discord embed +
button components; Feishu interactive card).

#### Security & licensing
- Git history scan: `git log --all -p | grep -E '8831298888|7747462834'` → confirm no leaked credentials
- `.env.example` only; `.env` in `.gitignore` (already)
- LICENSE: **MIT** (lowest friction, most permissive)
- `SECURITY.md`: how to report vulnerabilities (email)
- No telemetry, no analytics, no auto-update phone-home

#### Documentation
- `README.md` (target Quick Start ≤ 5 min):
  - 1-paragraph "what it is"
  - 30-second video/gif demo
  - Quick Start: clone → npm install → set 2 env vars → npm start
  - Architecture diagram (3-process model)
  - Link to per-channel guides
- `docs/architecture.md`: deep dive on transport abstraction, why `opencode attach` matters
- `docs/transports/telegram.md`: bot creation, env vars, troubleshooting
- `docs/transports/CONTRIBUTING-NEW-TRANSPORT.md`: how to implement Transport for a new channel
- `CONTRIBUTING.md`: dev setup, test/build commands, PR conventions
- `CHANGELOG.md`: start from v0.2.0

#### CI / repo hygiene
- GitHub Actions: `npm ci && npx tsc && npm test` on PR + main
- Issue templates: bug, feature request, channel request
- PR template: tests added/updated, no env leaked
- Dependabot for security updates

Exit criteria: a stranger clones the repo, follows README, has working Telegram bot in < 15 min.

Tag: `v0.3.0-rc.1`.

---

### M3 — v1.0 Public release
**Goal:** make repo public, get first 5–10 external users.

Pre-flight:
- Final security review (token handling, IPC paths, log redaction)
- Polish README + screenshots
- Pick a name? `opencode-remote-control` is descriptive but long.
  Alternative: `oprc` (binary), keep full name as repo. Decide before release.
- Set up GitHub Discussions for Q&A

Launch:
- Publish repo, tag `v1.0.0`
- Post to: opencode Discord (if exists), Hacker News "Show HN", r/programming
- Track first-week issues; respond within 24h

Exit criteria: external feedback loop established. ≥1 external bug report or PR merged.

---

### M4 — Web transport (8 weeks, large) ⬆️ prioritized
**Goal:** browser-based UI, mobile-friendly. Prioritized over chat platforms because
it has no external platform dependency and delivers the broadest reach.

Distinct value: no platform lock-in, real-time streaming over WebSocket, runs on phone via PWA.

Stack:
- Frontend: SvelteKit (smaller than Next.js, simpler than React for solo dev)
- Transport: WebSocket directly to bot process
- Auth: device pairing flow (scan QR from desktop → token stored in browser)
- Deploy: same bot process serves `/ws` for transport + static frontend on `/`

UX:
- Mobile-first layout
- Persistent session list sidebar
- Streaming text bubble (matches Telegram's edit-in-place approach)
- Approval UI: native HTML modal

Tag: `v1.1.0`.

---

### M5 — Discord transport (4 weeks) ↓ deferred
**Goal:** validate transport abstraction by building Discord first-party.
Deferred until after Web — Web is higher priority and more broadly useful.

- `discord.js` v14 (mature, well-documented)
- Map cards → Discord embeds; buttons → ActionRow components
- Slash commands (`/abort`, `/status`, etc.) via Discord's slash command API
- Add `transport/discord/` directory

Document any **abstraction gaps** found during implementation; if `Transport`
interface needs breaking changes, do them here before Feishu.

Exit criteria:
- Both transports run simultaneously (`TRANSPORT=telegram,discord` in env)
- Feature parity for all v1.0 commands
- Discord channel runs ≥ 2 weeks without channel-specific bugs

Tag: `v1.2.0`.

---

### M6 — Feishu transport (4 weeks) ↓ deferred
Deferred — implement after Discord validates the transport abstraction.

- Feishu (Lark) bot SDK: `@larksuiteoapi/node-sdk`
- Interactive cards via Feishu Message Cards
- Approval flow: Feishu has native approval components — leverage them
- Chinese-language defaults (i18n preliminary: `LOCALE=zh-CN|en-US`)

If implemented by a contributor: maintainer reviews architecture and security.

Tag: `v1.3.0`.

---

### M7+ — Ecosystem (only if traction)
Triggers (any one):
- ≥3 external contributors
- ≥100 GitHub stars
- ≥10 community-built transports requested

Possible directions:
- Plugin model: third-party transports as `@opencode-remote-control/transport-*` npm packages
- Plugin marketplace page on GitHub Pages
- Hosted PaaS? **Not recommended**: single-user-per-host model doesn't map to multi-tenant SaaS. Re-evaluate only with clear demand.

---

## Non-goals (forever)
- Multi-tenancy (each user = own bot)
- AI features beyond opencode (no separate LLM calls)
- Replacing the TUI (we relay, not replace)
- Native mobile apps (PWA via web transport covers this)
- Cloud-hosted opencode (out of scope)

---

## Decision points

| Decision | When | Default |
|----------|------|---------|
| License | M2 | MIT |
| Project name (rebrand?) | Before M3 | Keep `opencode-remote-control` |
| Build M4 (Web) in-house vs wait for contributor | After M3 | Build it (broadest reach, no platform dep) |
| Public name / handle for project owner | Before M3 | (user to decide) |
| Discord before or after Web? | Decided | Web first (M4), Discord second (M5) |
| Plugin model | M7 | Only if triggers met |

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Maintainer burnout | Keep scope ruthless; say no early; auto-close stale issues |
| opencode API breaks | Pin `@opencode-ai/sdk` version; smoke test against latest in CI; document compat matrix |
| Security incident (leaked token via PR) | Pre-commit hook + CI scan for token patterns; require 2-eye review for auth code |
| Bus factor = 1 | Docs assume fresh maintainer; `docs/MAINTAINERS.md` with operational runbooks |
| Channel platforms change APIs | Each transport pinned to specific SDK major; bump in dedicated PR |
| "It works on my machine" support load | Strict Quick Start with copy-paste commands; FAQ for common opencode setup issues |

---

## Success metrics

| Milestone | Metric | Target |
|-----------|--------|--------|
| M3 release | Stars in first month | ≥ 50 |
| M3 release | First external PR merged | within 30 days |
| M4 ship | Discord users (self-reported) | ≥ 5 |
| M6 ship | Web channel usage share | ≥ 30% within 60 days |
| Long-term | Total active installs | unknown; don't optimize for this — optimize for fit |

---

## Suggested timeline (best case)

```
2026-05  M0 (now)
2026-06  M1 Phase 2 ship
2026-07  M2 OSS prep
2026-08  M3 v1.0 public
2026-09  M4 Web (⬆️ prioritized)
2026-11  M5 Discord (↓ deferred)
2026-12+ M6 Feishu (↓ deferred)
```

Solo development assumption. Slip is expected; the milestone order matters
more than the dates.
