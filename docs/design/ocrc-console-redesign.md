# Handoff: OCRC Web Console — UI Redesign

## Overview
This package documents a redesign of the **OCRC (opencode remote-control)** web console — a chat-style control surface for driving coding agents on a remote backend. It is a three-pane desktop layout: a **session rail** (left), a **chat/transcript stream** (center) with a live tool-execution timeline, and a **telemetry inspector** (right). The redesign sharpens product identity (a "remote signal" brand mark, a consistent status grammar, a mono-forward engineering tone) and deepens interaction richness (live-streaming tool execution, collapsible reasoning, inline approval flow, command palette, working composer).

The existing app is **SvelteKit** (see `web/src/` in the OCRC repo: `routes/+layout.svelte`, `routes/[sessionId]/+page.svelte`, `lib/components/*`, `lib/theme.css`). The intent is to apply this redesign to that existing Svelte app, reusing its stores, API client, and WebSocket card stream.

## About the Design Files
The file in this bundle — **`OCRC Redesign.dc.html`** — is a **design reference created in HTML**, not production code to copy directly. It is an interactive prototype showing the intended look, layout, and behavior. It is authored in a small in-house template runtime (`support.js`, a React-backed `<x-dc>` component format); **do not port that runtime**. Your task is to **recreate this design in the existing OCRC SvelteKit codebase** using its established patterns (Svelte components, stores, existing `theme.css` custom properties), wiring it to the real session store, API client, and WS card stream.

Open `OCRC Redesign.dc.html` directly in a browser to interact with it. It ships with three tweak props (set on the root component): `accent` (`emerald` | `azure` | `amber` | `violet`), `showThinking` (bool), `liveDemo` (bool). All data in the prototype is mocked — the central "Fix WS reconnect avalanche" session runs a clock-driven fake turn so you can see the streaming states.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, and interaction states are specified below and are present in the HTML. Recreate the UI to match, using the codebase's component conventions. Where the prototype's mock data appears (session list, transcript, tool calls, inspector numbers), substitute the app's real data sources.

---

## Design Tokens

These extend the existing `lib/theme.css`. Names mirror the prototype's CSS custom properties.

### Color — surfaces & text
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#1c1b19` | App background (warm charcoal) |
| `--bg-panel` | `#181715` | Rail / inspector / titlebar panels |
| `--bg-elev` | `#262521` | Cards, chips, buttons (raised) |
| `--bg-elev2` | `#2d2b27` | Hover-raised |
| `--bg-input` | `#2a2824` | Inputs / composer field |
| `--border` | `#393631` | Primary hairline border |
| `--border-2` | `#302d29` | Secondary / inner divider |
| `--text` | `#f2f0ec` | Primary text |
| `--text-2` | `#c2bdb4` | Secondary text |
| `--text-3` | `#8d877c` | Tertiary / metadata |
| `--text-4` | `#6b665d` | Faint / disabled |

### Color — accent & status
| Token | Hex | Use |
|---|---|---|
| `--accent` | `#3fb27f` | Primary accent (emerald) — default theme |
| `--accent-2` (soft) | `#243029` | Accent-tinted fill |
| `--accent-ink` | `#06140d` | Ink on accent (button text) |
| `--accent-line` | `#2e6e52` | Accent-tinted border |
| user bubble gradient | `linear-gradient(135deg,#3fb27f,#2e9468)` | User message bubble |
| `--ok` | `#6cc08b` | Success / done / idle |
| `--warn` | `#e0b341` | Awaiting input / approval pending |
| `--err` | `#e0796b` | Error / abort / reject |
| `--hl-purple` | `#b48cf0` | Reasoning ("thinking") accent + branch name |
| `--hl-green` | `#6cc08b` | Tool argument text |
| `--hl-cyan` | `#4ec9b0` | Code-block language tag |
| `--hl-orange` | `#dca87a` | misc highlight |

### Alternate accent themes (the `accent` prop swaps these four vars)
| Theme | accent | soft | ink | line | gradient A→B |
|---|---|---|---|---|---|
| emerald (default) | `#3fb27f` | `#243029` | `#06140d` | `#2e6e52` | `#3fb27f`→`#2e9468` |
| azure | `#4a9eed` | `#1c2733` | `#06121f` | `#2f5f8c` | `#4a9eed`→`#2f7fd1` |
| amber | `#e0a341` | `#2e2716` | `#1f1606` | `#8c6e2f` | `#e6b256`→`#c98a2c` |
| violet | `#a98cf0` | `#221f33` | `#0f0a1f` | `#5e4f8c` | `#b48cf0`→`#8d6bd8` |

### Typography
- **Sans** (`--font-sans`): `Space Grotesk`, fallback `ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. Used for body copy, titles, buttons.
- **Mono** (`--font-mono`): `JetBrains Mono`, fallback `ui-monospace, SFMono-Regular, Menlo, monospace`. Used for ALL technical metadata: session ids, repo/branch, file paths, tool names/args, token counts, durations, costs, timers, labels.
- Type sizes in use: titlebar 13px; section labels 9.5–10px uppercase letter-spacing `.16em`; session title 13px/600; body message 14.5px/1.72; user bubble 14px; tool rows 12.5px mono; meta chips 10.5px mono; inspector big number 18–22px/600.

### Radius / shadow / spacing
- Radii: panels & cards `11–14px`; chips/buttons `6–9px`; pills/status `20px`; avatar/dot `50%`.
- Card shadow (user bubble): `0 2px 14px rgba(63,178,127,.16)`. Composer: `0 6px 24px rgba(0,0,0,.26)`. Palette: `0 24px 70px rgba(0,0,0,.6)`.
- Layout: rail `268px`, inspector `280px`, chat column `max-width 780px` centered. Titlebar height `52px`. Standard gaps 8–14px.
- Scrollbars: thin, `--border` thumb on transparent track.

### Status grammar (use everywhere a session/step/task has state)
- **Busy / running** → solid `--accent` dot, `ocrc-pulse` animation (opacity 1↔.28, 1.2s).
- **Awaiting input** → solid `--warn` dot.
- **Idle / done** → solid `--ok` dot.
- **Offline** → hollow dot, `1.5px solid --text-4` border, no fill.

### Keyframes
- `ocrc-pulse` — 0/100% opacity 1, 50% .28 (breathing dot).
- `ocrc-blink` — 0/100% opacity 1, 50% 0 (running step dot + text caret, `step-end`).
- `ocrc-ring` — scale .6→2.2, opacity .7→0 (expanding signal ring on the brand mark & live indicator).
- `ocrc-shimmer` — background-position sweep (running tool progress bar).

---

## Screens / Views

There is one screen: the **console**, composed of a titlebar and three panes, plus a **command-palette overlay**.

### A. Titlebar (height 52px, `--bg-panel`, bottom `1px solid --border`)
Left→right:
1. **Brand mark** — 26×26 rounded-8 square, `--accent-2` fill, `--accent-line` border, containing a solid center dot plus two expanding `ocrc-ring` rings (1.1s offset) → the "remote signal" motif. Followed by wordmark `OCRC` (mono, 700, letter-spacing `.14em`).
2. **Backend selector** — raised chip: small accent square + backend name (`opencode`) + `▾`. (In prototype this cycles the accent theme; in production it should switch backend.)
3. **Command-palette trigger** — input-styled button, min-width 230px: `⌕` + "Search sessions & commands…" + `⌘K` keycap. Opens the palette overlay.
4. *(spacer)*
5. **Connection pill** — rounded-20: live `--ok` dot with `ocrc-ring` halo + "live" (ok-colored, 600) + `{latency}ms` (mono). Latency is live in prototype (38–45ms wobble); bind to real ping.
6. **User** — `you@local` (mono) + 26px avatar (accent-tinted circle, mono initials).

### B. Session Rail (width 268px, `--bg-panel`)
- **Header row**: "SESSIONS" (uppercase 10px, `.16em`, `--text-3`) + a `+` new-session button.
- **Workspace filter chips**: `all` (active: accent-2 fill / accent text / accent-line border) · `ocrc` · `web` (inactive: `--text-3`, `--border-2` border), mono 10.5px.
- **Grouped list** (scrollable). Groups: **Pinned**, **Recent**. Group header = label + hairline rule + count, all `--text-4` mono uppercase `.16em`.
- **Session row** (`9px 12px 9px 16px`, radius 9):
  - Selected: `--accent-2` background + a `2.5px` accent left bar (absolute, inset 9px top/bottom). Hover (unselected): `--bg-elev`.
  - Line 1: status dot (per grammar) + title (13px/600, ellipsis; selected `--text`, else `--text-2`) + optional pinned dot (accent `●`).
  - Line 2 (indented 16px, mono 10.5px `--text-3`): `{shortId}` (text-2) · `{repo}` · `{time}` · then if diff: `+{adds}` (ok) `−{dels}` (err).
  - If busy: a 3px progress track (`--border-2`) with an accent gradient fill at `{progPct}%`.
- **Footer**: ok dot + `{n} active` · `{n} pushed` · `{n} dropped` · `v0.6.2` (mono 10px `--text-4`).

Prototype sessions (replace with store data): `Fix WS reconnect avalanche` (busy, pinned, +142/−38, repo ocrc), `Validate pinned session` (wait, web), `Phase 3 · multi-backend` (idle, ocrc), `PWA offline shell` (idle, +88/−12, web), `Telegram approval callbacks` (offline, tests).

### C. Chat Main (flex:1, `--bg`)
- **Sub-header** (`11px 22px`, bottom `1px solid --border-2`): session title (14px/650) + branch chip (mono 11px in `--bg-elev`/`--border-2`) — actually branch shown as `--hl-purple` mono in the running state header. Right side: when busy, a **running pill** (`EXECUTING`/`running {timer}` with pulsing accent dot) styled in accent-2; when idle, `idle` label. A **Replay** / **Abort** affordance sits here (Abort: ghost button, hover → `--err`).
- **Transcript column** (`max-width 780px`, centered, `padding 22px 24px`). Card types:

  **User message** — right-aligned bubble, `max-width 82%`, `border-radius 18px 18px 4px 18px`, user-bubble gradient, ink `#f2fbf6`, soft accent shadow. `white-space:pre-wrap`.

  **Assistant turn** — full width, composed of (in order):
  1. **Reasoning toggle** (optional): mono 11px `--hl-purple` button — a rotating `▸` caret + "thought for {n}s". Expanded: left-border `2px --hl-purple`, tinted bg `rgba(180,140,240,.06)`, italic-feel mono 12px reasoning text.
  2. **Execution panel** (the signature element): `--bg-elev` card, `--border-2`, radius 11. Header: "EXECUTION" (uppercase 9px `--text-4`) + hairline + `{done}/{total} steps`. Rows, each mono 12.5px:
     - status dot (running = accent with `0 0 7px` glow + `ocrc-blink`; done = `--ok`; error = `--err`; pending = hollow `--text-4`),
     - tool **name** (`read`/`grep`/`edit`/`bash`/`write`, weight 500; running→`--text`, error→`--err`, else `--text-2`),
     - tool **arg** (`--hl-green`, ellipsis, flex:1, e.g. a file path or pattern),
     - optional diff badge `+{adds}` (ok) `−{dels}` (err),
     - while running: a `42×4` shimmer bar (`ocrc-shimmer`); when done: duration (`--text-4`, e.g. `1.4s`),
     - if the step has detail: a rotating `▸` caret; clicking the row expands a **detail box** (mono 11.5px, `--bg` inset, `--border-2`, radius 8, `white-space:pre-wrap`) showing tool output/diff preview.
  3. **Text blocks**: paragraphs (15px/1.72); fenced **code blocks** (header bar with cyan square + language tag + file path, body `pre` mono 12px on `#151412`); bullet **lists** (accent `▪` markers). The final streaming paragraph shows a blinking accent **caret** while text is still arriving.
  4. **Meta + actions row**: chips (mono 10.5px) — agent (`build`, accent on accent-2), model (`sonnet-4`), tokens (`↑{in} ↓{out}`), duration, cost (`${n}`, warn-colored) — then right-aligned **copy** (`⧉`→`✓` on click) and **retry** (`↻`) icon buttons (26px, `--border-2`).

  **Approval card** (gated tool call) — full-width card, `--bg-elev`. Pending: `--warn` border + warn header bg + `APPROVAL REQUIRED` (warn). Header also shows `{tool} · {path}`. Body: summary paragraph + a `pre` diff preview (`#151412`). Actions: **Approve** (solid accent, ink text), **Always allow** (accent-2 outline), spacer, **Reject** (ghost → err). Once resolved, the action row is replaced by a status line: approved → accent `✓ Approved — patch applied to {path}` (or "auto-allow set"); rejected → err `✕ Rejected — patch discarded`, and the card border de-emphasizes.

  **Note** — centered mono 12.5px `--text-3` (e.g. backend-offline message).

- **Composer** (`padding 6px 24px 18px`, centered 780px): `--bg-input` field, `--border` (→`--accent` when non-empty), radius 14, shadow `0 6px 24px rgba(0,0,0,.26)`. Auto-grow `textarea` (15px, min 24 / max 140px). Footer row: agent/model selector chip (opens palette), `/ for commands` hint, spacer, `↵ send · ⇧↵ newline`, and a 33px round **send** button (accent when enabled, up-arrow icon). Enter submits (Shift+Enter newline; guard IME composition).

### D. Inspector (width 280px, `--bg-panel`, left `1px solid --border-2`)
- **Header**: "SESSION" label + active session title.
- **Tasks**: header + `{done}/{total}` + a `4px` progress track (accent gradient). Each todo row (clickable to toggle): a 15px status box — done = filled accent with `✓` ink; running = accent-outlined box with pulsing inner dot; pending = `--border` outline — and label (done → `--text-3` strikethrough).
- **Context**: header + `{pct}%`; big number `{used}` + `/ {max} tokens` (mono); a 7px segmented/solid bar (accent gradient) at `{pct}%`; model line with cyan square.
- **Working dir**: header + `+{adds}/−{dels}`; `{repo} · {branch}` line; file rows (`--bg-elev`, mono 11px): change-type color square + path (ellipsis, RTL truncation to keep filename) + `+{adds}` (ok) `−{dels}` (err).

Inspector content is **per-session** (switch with the active session).

### E. Command Palette (overlay)
- Backdrop `rgba(8,7,6,.62)`, centered card `min(560px,92%)`, `--bg-elev`, `--border`, radius 14, big shadow, opens 84px from top.
- Search header: `⌕` + text input ("Jump to a session, or run a command…") + `esc` keycap.
- Result groups: **Sessions** (icon `#`, accent) and **Commands** (e.g. New session, Cycle accent color, Clean up subagents, Toggle thinking blocks). Each row: 24px icon tile + label + right-aligned hint. Live-filters on input. Empty → "No matches".
- Opens via titlebar trigger, composer chip, or `⌘K`; closes on backdrop click / `esc`.

---

## Interactions & Behavior
- **Session select**: clicking a rail row (or a palette session result) sets the active session; chat + inspector re-render for it. Selecting the live session restarts its demo turn (production: just load the session).
- **Streaming turn** (the core motion): tool steps advance pending → running → done on a timeline; the running step shows a glowing blinking dot + shimmer bar; when steps finish, the answer text streams in character-by-character with a blinking caret; finally the meta row appears. Drive this from the real WS card stream (each tool call and the assistant text are cards).
- **Reasoning toggle**: expand/collapse the "thought for Ns" block. Default-collapsed; `showThinking` prop can default-open.
- **Tool-row expand**: rows with detail toggle a detail box (caret rotates 0→90°).
- **Approval**: Approve / Always allow / Reject resolve the card in place to a status line.
- **Composer send**: optimistic — appends the user message + a pending assistant card immediately, then resolves. Enter to send, Shift+Enter newline, IME-safe.
- **Command palette**: `⌘K` open, `esc`/backdrop close, type to filter, click to run/jump.
- **Copy**: copies the message; icon flips `⧉`→`✓` for ~1.3s.
- **Accent theme**: `accent` prop (or the "Cycle accent color" command) swaps the four accent vars app-wide.

## State Management
Per the existing OCRC stores; the prototype models:
- `activeSessionId`; `sessions[]` (id, title, repo, branch, status ∈ busy|wait|idle|off, shortId, time, diff adds/dels, pinned, progress).
- Transcript `cards[]` per session (user | assistant | approval | note). Assistant card: `thinking?`, `tools[]` (name, arg, status, adds/dels, dur, detail), `blocks[]` (paragraph | code | list), `meta` (agent, model, tokensIn/Out, dur, cost), `streaming?`.
- Live turn driven by WS card events (append/replace by stable card id — note the redesign's origin story is fixing avalanche re-renders, so **key transcript items by stable id**, not array index).
- UI-local: `openThinking{}`, `expandedTools{}`, `todoDone{}`, `composerText`, `paletteOpen`, `query`, `approvals{}`, `copiedId`, `accent`.
- Inspector per session: `todos[]` (text, state), context `used/max/pct`, `model`, working-dir `repo/branch/adds/dels/files[]`.

## Assets
No external image assets. The brand mark, status dots, signal rings, waveform, and all icons are CSS/inline-SVG. Fonts load from Google Fonts (**Space Grotesk**, **JetBrains Mono**) — in production, self-host or use the app's existing font pipeline. If OCRC has its own logo, swap the CSS brand mark for it but keep the expanding-signal-ring motif if possible.

## Files
- `OCRC Redesign.dc.html` — the high-fidelity interactive design reference (open in a browser). Contains the full template + the mock-data/interaction logic. All visual values above are present inline.
- `support.js` — the prototype runtime ONLY (so the HTML opens standalone). **Do not port.**
- Target codebase references (in the OCRC repo, not this bundle): `web/src/lib/theme.css`, `web/src/routes/+layout.svelte`, `web/src/routes/[sessionId]/+page.svelte`, `web/src/lib/components/{SessionRail,SessionList,CardUser,CardAssistant,ToolCallList,Composer,Inspector}.svelte`.
