# Handoff: OCRC Web Console — UI Redesign

## Overview
This package documents a redesign of the **OCRC (opencode remote-control)** console — a chat-style surface for driving **multiple coding agents** on remote backends. The core information-architecture principle: **agent is the top-level axis**, sessions live *under* the selected agent, and a session opens a chat transcript with a live tool-execution timeline and a telemetry inspector.

It ships in **two form factors that share one design language, tokens, and component vocabulary**:
- **Desktop** (`OCRC Redesign.dc.html`) — a single collapsible **left panel** (agent dropdown at top → that agent's sessions below), a center **chat/transcript** stream, and a right **inspector**.
- **Mobile** (`OCRC Mobile.dc.html`) — a **Sessions screen** (horizontal agent switcher at top → that agent's sessions below) → **Chat screen**, with inspector, command palette, new-session, and theme as **bottom sheets**, plus a **FAB speed-dial**.

The existing app is **SvelteKit** (`web/src/`: `routes/+layout.svelte`, `routes/[sessionId]/+page.svelte`, `lib/components/*`, `lib/theme.css`). Recreate this redesign in that codebase, wiring it to the real agent/backend list, session store, API client, and WebSocket card stream.

## About the Design Files
The two files are **interactive design references authored in HTML**, not production code to copy. They run on a small in-house template runtime (`support.js`, a React-backed `<x-dc>` format) — **do not port that runtime**. Recreate the UI with the codebase's own patterns (Svelte components, stores, the existing `theme.css` custom properties).

Open either file in a browser to interact. Both expose two tweak props on the root component: `showThinking` (bool) and `liveDemo` (bool). **All data is mocked**; the "Fix WS reconnect avalanche" session (under agent *atlas*) runs a clock-driven fake turn so you can watch streaming states.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, and interaction states are specified below and present in the HTML. Substitute the prototype's mock data (agents, sessions, transcripts, inspector numbers) with the app's real sources.

---

## Core Concepts & Information Architecture

**Agents** are the primary axis — each is a remote backend/agent you connect to (prototype: `opencode`@mac-studio, `claude-code`@devbox-2, `forge`@ci-runner, `aider`@edge-node, the last "connecting"). Each agent is shown with a **2-letter glyph** (OC / CC / FG / AI) — **in production, swap the glyph for the real agent logo**. Each agent:
- owns a **theme color** (auto-assigned default; user-overridable per agent — see Theming),
- has a **connection status** (online / connecting / offline),
- contains its own list of **sessions**.

**Sessions** belong to one agent. Selecting an agent shows *that agent's* sessions; selecting a session opens its chat. Switching agent changes the chrome theme and the visible session list together.

This split — **pick agent → pick session → chat** — is expressed differently per form factor but is the same model:
- **Desktop:** agent picker is a dropdown at the top of the left panel; the agent's sessions fill the panel directly below (both always visible together, no separate step).
- **Mobile:** a horizontal agent switcher sits at the top of the Sessions screen; the agent's sessions fill the list below (agent + session selection on one screen).

### Theming — chrome themes, content does not
This is a deliberate rule: **the agent theme colors the *chrome* only — the conversation content stays a constant emerald** regardless of which agent/theme is active.
- **Themed (follows active agent):** agent dropdown/switcher, status accents, session-rail selection bar, task/context progress bars, composer send button & focus border, inspector accents, FAB.
- **Fixed emerald (never changes):** user message bubbles, the execution-panel running dot + shimmer, streaming caret, bullet markers, approval-card accents & Approve button, copy-confirm. In the prototype this is done by re-declaring the accent custom properties back to emerald on the transcript scroll container; do the equivalent (scope a fixed palette to the message list).
- Token cost is **not** shown per-message (see Inspector → Usage).

### Theme assignment
Defaults: opencode→emerald, claude-code→azure, forge→amber, aider→violet. A user can override an agent's theme manually (the override persists per agent; "Auto" reverts to the agent default). On desktop this lives in the agent-picker footer (swatches + auto); on mobile in a Theme bottom sheet.

---

## Design Tokens

Extends the existing `lib/theme.css`.

### Color — surfaces & text
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#1c1b19` | App background (warm charcoal) |
| `--bg-panel` | `#181715` | Rail / inspector / titlebar |
| `--bg-elev` | `#262521` | Cards, chips, buttons |
| `--bg-elev2` | `#2d2b27` | Hover-raised / popover rows |
| `--bg-input` | `#2a2824` | Inputs / composer |
| `--border` | `#393631` | Primary hairline |
| `--border-2` | `#302d29` | Secondary divider |
| `--text` … `--text-4` | `#f2f0ec` / `#c2bdb4` / `#8d877c` / `#6b665d` | Text ramp (primary→faint) |

### Color — chrome accent (themed per agent)
| Theme | accent | soft (`-2`) | ink | line |
|---|---|---|---|---|
| emerald (default / opencode) | `#3fb27f` | `#243029` | `#06140d` | `#2e6e52` |
| azure (claude-code) | `#4a9eed` | `#1c2733` | `#06121f` | `#2f5f8c` |
| amber (forge) | `#e0a341` | `#2e2716` | `#1f1606` | `#8c6e2f` |
| violet (aider) | `#a98cf0` | `#221f33` | `#0f0a1f` | `#5e4f8c` |

### Color — fixed conversation palette (NEVER themed)
`--cv:#3fb27f` · `--cv-2:#243029` · `--cv-ink:#06140d` · `--cv-line:#2e6e52` · user bubble gradient `linear-gradient(135deg,#3fb27f,#2e9468)`.

### Color — status & semantic
`--ok:#6cc08b` (done/idle/online) · `--warn:#e0b341` (awaiting input / approval / connecting) · `--err:#e0796b` (error/reject/offline) · `--hl-purple:#b48cf0` (reasoning + branch name) · `--hl-green:#6cc08b` (tool args) · `--hl-cyan:#4ec9b0` (code lang tag).

### Status grammar (everywhere a thing has state)
- **busy/running** → solid accent dot, `pulse` (or `blink` for tool steps), often with glow.
- **awaiting input / approval / connecting** → solid `--warn` dot (connecting also pulses).
- **idle/done/online** → solid `--ok` dot.
- **offline** → hollow dot (`1.5px solid --text-4`, no fill).

### Typography
- **Sans** `Space Grotesk` (fallback `ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`) — body, titles, buttons.
- **Mono** `JetBrains Mono` (fallback `ui-monospace,SFMono-Regular,Menlo,monospace`) — ALL technical metadata: agent/host, ids, paths, tool names/args, tokens, durations, costs, timers, section labels.
- Scale: section labels 9.5–10px uppercase `.16em`; session title 13px/500–600; body message 14.5px/1.72; user bubble 14px; tool rows 12.5px mono; meta chips 10.5px mono; inspector big number 18–22px/600.

### Radius / shadow / layout
- Radii: panels/cards 11–15px; chips/buttons 6–9px; pills 20px; dots 50%.
- Shadows: user bubble `0 2px 14px rgba(63,178,127,.16)`; composer `0 6px 24px rgba(0,0,0,.26)`; popovers `0 18px 50px rgba(0,0,0,.55)`; modals/sheets `0 24px 70px rgba(0,0,0,.6)`.
- Desktop layout: left panel **250px** (collapsible to 0), inspector **280px**, chat column `max-width 780px` centered, titlebar 52px. (The earlier separate 66px agent dock was removed — agents now live as a dropdown inside the left panel.)
- Keyframes: `pulse` (breathing dot), `blink` (running step / caret, step-end), `ring` (expanding signal ring — brand mark + live + status), `shimmer` (running tool bar), `pop` (popover/menu entrance), `sheetin` (mobile bottom-sheet rise), `fab` (speed-dial stagger). NOTE: entrance animations must not use `fill-mode: both` (it leaves elements invisible before play); let resting state be the default.

---

## Desktop Screens

### Titlebar (52px, `--bg-panel`)
Brand mark (signal-ring motif) + wordmark · **`+ New ▾`** primary button (opens the multi-action menu) · command-palette trigger (`⌕ Search agents, sessions, commands… ⌘K`) · spacer · live+latency pill · `you@local` + avatar.

### Left Panel (250px, collapsible) — agent + sessions in one
- **Agent dropdown** (top): a pill showing the active agent's glyph (with status dot) + name + host + `▾`. Opens the **Agent Picker** popover. A **collapse** chevron sits at the right of the header.
- **Agent Picker popover:** list of agents — each row = themed glyph tile, name, `host · N ses`, status dot, check on active; selecting switches agent (theme + session list update). Footer: a **Connect agent…** row, then **Theme · {agent}** with the 4 color swatches + an **auto** button (manual override / revert).
- **Session list** (for the active agent): rows with status dot (grammar), title, pinned dot; second line `shortId · time · +adds/−dels` (mono); a shimmer/gradient progress bar when busy. Selected row = `--accent-2` bg + 3px accent left bar. Empty state: "no sessions on {agent} yet".
- **Footer:** `N active · N pushed` (mono).
- **Collapsed:** the whole panel hides; the chat header shows an **expand** chevron + the session switcher (below), so you keep on-demand session switching with the panel closed.

### Chat (center, flex)
- **Sub-header:** when collapsed, an expand button; then the **session switcher** button (agent glyph + active session title + `▾`) opening a popover of the agent's sessions (+ "New session on {agent}"); a branch chip; right side shows a **running {timer}** pill + **Abort** when busy, else `idle`.
- **Transcript** (`max-width 780px`, centered) — **conversation palette is fixed emerald here regardless of agent theme**. Card types:
  - **User** — right-aligned emerald gradient bubble, `18px 18px 4px 18px`.
  - **Assistant** — optional **reasoning** toggle ("thought for Ns", purple, expandable); the **Execution panel** (the signature element: `EXECUTION` header + `done/total steps`; rows = status dot [running glow+blink / done / error / pending] + tool name + arg (green) + optional `+/−` diff + shimmer-while-running / duration + expand caret → detail box); **text blocks** (paragraphs with streaming caret, fenced code blocks with cyan lang tag, bullet lists with emerald `▪`); a **meta row** = agent · model · duration chips + copy/retry (⧉→✓). **Token cost is NOT on the message** — it lives in the inspector.
  - **Approval** — gated tool call: warn-bordered while pending (`APPROVAL REQUIRED`, tool·path, summary, diff preview, **Approve** / **Always allow** / **Reject**); resolves in place to a status line (applied / auto-allow / discarded).
  - **Note** — centered mono (e.g. backend offline; new-session "send a message to start").
  - **Empty (no active session):** centered agent glyph + "No active session on {agent}" + **+ New session**.
- **Composer:** auto-grow textarea; footer = agent·model chip, `/ for commands`, send hint, round send button (themed; enabled when non-empty). Enter sends, Shift+Enter newline, IME-safe; sending is optimistic (appends user + pending assistant immediately).

### Inspector (280px) — Tasks flex, the rest pinned to the bottom
**Session** header (agent · session title) at the top. Below it, **Tasks** (progress bar + toggleable checklist) takes the **flexible middle and scrolls**. The three reference panels are **pinned to the bottom**, stacked bottom-up: **Working dir** (dir, repo·branch, changed files `+/−`), then **Usage**, then **Context** (used / max tokens, % bar, model) at the very bottom. **Usage** leads with **tokens** (two TOKENS IN / TOKENS OUT tiles, mono) and shows **`est. spend $`** as a small, de-emphasized line (cost is often inaccurate; tokens are the signal). Usage totals are the session's cumulative tokens/cost.

### Overlays
- **`+ New` multi-action menu:** New session (pick dir & branch) · Connect agent · Command palette (⌘K).
- **New-session modal:** Agent picker (themed chips) · **Working directory** (required; `host:` prefix + path input + Browse + **recent** dirs) · Branch (optional) · Cancel / Create. Creating adds the session under the agent and opens it.
- **Command palette (⌘K):** filters across **Agents** (jump+switch), **Sessions** (jump across all agents), **Commands** (new session, connect agent, switch agent/set theme, collapse rail).

---

## Mobile (`OCRC Mobile.dc.html`)

Same language/tokens/cards; phone layout (prototype 392×838 frame; production = a responsive PWA breakpoint).

### Sessions screen (root)
- Header: brand + `live` pill.
- **Agents** — horizontal scroll row of agent **pills** (2-letter glyph tile + status dot + full name + `N ses`); active is filled with the agent's theme. Tapping switches agent (theme + session list update). A trailing **“⋯ all N”** button opens a **searchable Agent sheet** (filter input + every agent with host · session count + current check) — the scalable path when agents exceed the row width. **Agent + session selection live on one screen.**
- Active-agent header (name · host + a **theme** button that shows the current accent swatch) + search button (opens command sheet).
- **Sessions** list for the active agent (status dot, title, status tag chip, id·time·diff, busy progress + current tool).
- **FAB speed-dial** (`+`, bottom-right): expands to **New session**, **Connect agent**, **Settings**, **Search & commands** (the `+` rotates 45°; backdrop dims).

### Chat screen
Back chevron + agent glyph + session title + branch/running + inspector button (task-count badge). Transcript identical to desktop (**conversation fixed emerald** under any agent theme). Bottom composer (pill + round send).

### Bottom sheets (rise with `sheetin` over a scrim)
- **Inspector:** Tasks → Context → **Usage** (tokens-first, `est. spend` secondary) → Working dir.
- **Agents:** searchable list opened from the agent row's “all N” button — every agent with host · session count + current check.
- **New session:** Agent chips · Working directory (`host:` + recents) · Branch · Create → opens the new chat.
- **Theme:** 4 swatches + Auto, per active agent.
- **Command:** Agents / Sessions / Commands, live-filtered.

### Mobile notes
Touch targets ≥44px (FAB 56px, full-width primary buttons). Sheets bottom-anchored with device-radius (43px) bottom corners. Status bar + home indicator are prototype device chrome — drop in the real PWA. Reuse the same components as desktop at slightly tighter sizes (one component set, two breakpoints) — don't fork.

---

## Interactions & Behavior
- **Agent switch:** desktop via the dropdown→picker (or palette); mobile via the top switcher row (or palette). Updates theme + session list + active session.
- **Session switch (on-demand):** rail row, chat-header switcher popover, or palette — works whether the rail is open or collapsed.
- **Collapsible rail (desktop):** collapse to reclaim width; expand from the chat header.
- **Streaming turn:** tool steps advance pending→running→done (running = glow+blink+shimmer); then answer text streams with a caret; meta row appears last. Drive from the real WS card stream — **key transcript items by stable id, not array index** (the redesign's origin story is fixing avalanche re-renders from index-keyed rendering).
- **Reasoning / tool-detail:** expand/collapse; `showThinking` prop can default reasoning open.
- **Approval:** Approve / Always allow / Reject resolve the card in place.
- **New session:** requires a working directory (host-prefixed; recents for quick pick) + optional branch; creates under the chosen agent and opens it.
- **Theme override:** per-agent manual swatch; "Auto" reverts to agent default; affects chrome only.
- **Copy:** flips ⧉→✓ ~1.3s.

## State Management
Model the prototype mirrors (map to existing OCRC stores):
- `agents[]` (id, name, glyph, host, theme, status) + `activeAgentId`; `themeByAgent{}` overrides.
- `sessionsByAgent` + per-session def (id, title, shortId, time, status ∈ busy|wait|idle|off, diff adds/dels, pinned, branch, dir). `activeSessionId`.
- Transcript `cards[]` per session (user | assistant | approval | note). Assistant: `thinking?`, `tools[]` (name, arg, status, adds/dels, dur, detail), `blocks[]` (paragraph | code | list), `meta` (agent, model, tokensIn/Out, dur, cost), `streaming?`. Drive via WS card events; **append/replace by stable card id**.
- Inspector per session: todos, context used/max/%, model, working-dir repo/branch/dir/files; **Usage = summed tokens & cost across the session's assistant metas**.
- UI-local: `railOpen`, `agentPickerOpen`, `switcherOpen`, `plusOpen`, `newSessionOpen`, `paletteOpen`/`query`, `fabOpen` (mobile), `inspectorOpen`/`themeMenuOpen` (mobile sheets), `openThinking{}`, `expandedTools{}`, `todoDone{}`, `composer`, `approvals{}`, `copiedId`.

## Assets
No image assets — brand mark, status dots, signal rings, glyph tiles, and icons are CSS/inline-SVG. Fonts via Google Fonts (Space Grotesk, JetBrains Mono) — self-host or use the app's font pipeline in production. If OCRC has a real logo, swap the CSS mark but keep the expanding-signal-ring motif if possible.

## Files
- `OCRC Redesign.dc.html` — high-fidelity **desktop** reference (single agent+session left panel, chat, inspector). Full template + mock data/logic inline.
- `OCRC Mobile.dc.html` — high-fidelity **mobile** reference (agent switcher → sessions → chat; sheets; FAB). Shares all tokens/cards with desktop.
- `support.js` — prototype runtime ONLY (so the files open standalone). **Do not port.**
- Target codebase (in the OCRC repo, not this bundle): `web/src/lib/theme.css`, `web/src/routes/+layout.svelte`, `web/src/routes/[sessionId]/+page.svelte`, `web/src/lib/components/{SessionRail,SessionList,CardUser,CardAssistant,ToolCallList,Composer,Inspector}.svelte`.
