# Phase 5 — Web UI (High-Level Outline)

> **Outline only.** Phase 5 starts after Phase 3 + Phase 4 ship. A full
> design spec is brainstormed then with the actual `Transport` interface
> in hand. This document exists so the Phase 3 interface is shaped with
> Web in mind, not Discord/Feishu speculation.

## Goal

Add a browser-based transport to `opencode-remote-control`, served from
the same Node process as the Telegram transport. Two form factors share
one codebase:

1. **PWA** — mobile-first, installable to home screen, online via
   localhost / Tailscale / Cloudflare Tunnel
2. **Chrome Extension** — side panel + context menu integration; runs in
   the user's browser, talks to the same WebSocket endpoint as the PWA

Streams via WebSocket. Tag: **v0.5.0**.

## Why a Web transport (positioning)

- We already have a working Telegram transport. Web is the natural second
  consumer to validate the abstraction.
- OpenChamber (4.3k★) offers web+desktop+VS Code+terminal but **not**
  Telegram. We complement them by having both Telegram and Web in one
  install, simplifying the "I'm at my desk → I'm in transit" workflow.
- Web transport reuses the relay, state, and Card model from Phase 3 — no
  duplicate business logic.

## Picture (wireframe)

### Desktop

```
┌─────────────────────────────────────────────────────────────┐
│  opencode-remote-control            🟢 connected   ⚙        │
├──────────┬──────────────────────────────────────────────────┤
│ SESSIONS │  ┌────────────────────────────────────────────┐  │
│          │  │ User                                       │  │
│ • ses…3  │  │ implement F1 streaming                     │  │
│   build  │  └────────────────────────────────────────────┘  │
│   2m ago │                                                  │
│          │  ┌────────────────────────────────────────────┐  │
│ • ses…1  │  │ Assistant • build · k2p6                   │  │
│   plan   │  │ Working through the design... ▌            │  │
│   1h ago │  │ ▸ bash · ls -la                            │  │
│          │  │ ▸ read · src/handlers/chat.ts              │  │
│ + New    │  └────────────────────────────────────────────┘  │
├──────────┴──────────────────────────────────────────────────┤
│  [ Send a message ]               🎙 📎 ➤                   │
└─────────────────────────────────────────────────────────────┘
```

### Mobile

```
┌────────────────────┐
│ ☰  ses…3 (build)   │
├────────────────────┤
│                    │
│  ┌──────────────┐  │
│  │ User: ...    │  │
│  └──────────────┘  │
│                    │
│  ┌──────────────┐  │
│  │ Assistant... │  │
│  │ ▸ bash · ls  │  │
│  └──────────────┘  │
│                    │
├────────────────────┤
│ [ message ]    ➤  │
└────────────────────┘
```

Sidebar collapses to a hamburger; same chat area; bottom command bar.

### Chrome Extension (side panel)

```
┌────────────────────┐  ← Chrome side panel (open via toolbar icon)
│ ⚙  ses…3 (build)   │
├────────────────────┤
│ ┌──────────────┐   │
│ │ Assistant... │   │
│ └──────────────┘   │
├────────────────────┤
│ Send to opencode:  │
│ [ message ]    ➤  │
│ ⊕ include current  │
│   page selection   │
└────────────────────┘
```

Plus right-click "Send selection to opencode" context menu on any web
page. Selection text + page URL pass as a structured prompt: e.g.

```
[Page: https://opencode.ai/docs/sdk/]
[Selection]
const result = await client.session.prompt({...})
[Question] write a typed wrapper around this
```

## Form-factor matrix

| Form factor | Where | When the user opens it | What it knows about |
|---|---|---|---|
| Mobile PWA | Phone home screen | Away from desk | Bot's session state |
| Desktop browser | Any laptop's browser | Cross-device usage | Bot's session state |
| Chrome side panel | Always-on while browsing | Working in browser, debugging docs | Bot's session state + current tab URL + selection |

All three share **one SvelteKit codebase** built into different bundles:
- PWA: `dist/web/` served by Hono at `/`
- Chrome Extension: `dist/extension/` with `manifest.json`, packaged as a
  Chrome Web Store submission (or sideloaded zip)

The extension's side panel page is the same Svelte app as the PWA, with a
small additional file (`extension/background.ts`) that handles the
context-menu integration. Everything else (auth flow, WebSocket
client, card rendering) is shared.

## Stack (preliminary, finalize in Phase 5 brainstorm)

| Concern | Choice | Why |
|---|---|---|
| Frontend framework | **SvelteKit 5** | Smaller bundle than React, simpler than VS Code for solo dev. OpenChamber uses Tauri+TypeScript; kcrommett/opencode-web uses TanStack Start + React. We pick Svelte for the bundle-size advantage on mobile PWA. |
| Server runtime | **Hono** in same Node process | Lightweight, fits in the existing bot process. Serves `/api`, `/ws`, static `/`. |
| Transport (frontend ↔ backend) | **WebSocket** | Native streaming → `capabilities.streaming: true`. No edit-throttle hack. |
| Auth | **Device pairing via QR + token cookie** | Desktop running the bot displays/logs a 6-digit code. User enters it on first phone visit. Cookie persists. |
| Build & bundling | **Vite** (SvelteKit default) | Industry standard. |
| Static serving | Bot process serves built files | Single deployment artifact. |
| Chrome Extension | **Manifest V3** with side panel API | Side panel API (Chrome 114+) gives native sidebar UX; manifest v3 is the only forward-compatible option. |
| Extension distribution | Chrome Web Store + sideload zip | Store reach + dev-mode sideload for power users. |

## Auth flow (concrete)

1. User opens `https://<bot-host>/` on their phone.
2. First-visit: server shows "Pair this device" + an input field.
3. On the desktop (or in bot's stdout/launchd log), a 6-digit code prints
   every 5 minutes. User reads it.
4. User types the code on phone → server validates → issues cookie + stores
   device id in `state.json` under `pairedDevices: [...]`.
5. Future visits auto-authenticated via cookie.
6. Bot owner can revoke a device by removing it from `state.json`.

No public exposure required for personal use: bot binds to `localhost`,
user accesses via Tailscale / ngrok / Cloudflare Tunnel.

## Capabilities surface

| Capability | Web value | Effect on relay |
|---|---|---|
| `edit` | `true` | Updates streamed text bubbles |
| `maxMessageLength` | `Number.POSITIVE_INFINITY` | No chunking |
| `buttons` | `true` | Native HTML buttons |
| `richText` | `true` | Full HTML/markdown |
| `streaming` | `true` | WebSocket push every delta; relay skips throttle |

When `capabilities.streaming` is true, the relay pushes every delta
immediately. Telegram has `streaming: false` and continues to use throttled
edits. Same code path; behavior diverges based on the flag.

## What Phase 5 implementation involves (not detailed here)

### Shared Web codebase
- `src/transport/web/` directory with `createWebTransport(): Transport`
- WebSocket server in same Node process
- SvelteKit app at `src/web-ui/` (or separate `web/` workspace package)
  with `app.svelte` (shared root) + two adapter entry points:
  - `entries/pwa.ts` — PWA service worker + manifest
  - `entries/extension.ts` — extension side panel adapter
- Build step: `npm run build` produces three bundles: bot JS, web/ static,
  extension/ packaged zip
- New env: `WEB_HOST`, `WEB_PORT`, `WEB_SESSION_SECRET`, `WEB_PAIRING_CODE_TTL`
- New routes: `/api/sessions`, `/api/messages`, `/ws`, `/`, `/pair`
- E2E tests with Playwright (PWA + extension)

### Chrome Extension specifics
- `extension/manifest.json` — Manifest V3, declares `sidePanel` + `contextMenus` + `host_permissions`
- `extension/background.ts` — service worker handling context menu clicks
- `extension/sidepanel.html` — loads the shared Svelte app pointed at the configured WebSocket
- Extension-only env in side panel local storage: `OPRC_BOT_URL` (where to connect; defaults to `http://localhost:<WEB_PORT>` with override for Tailscale users)
- Distribution: Chrome Web Store listing (~1 week review) + sideload zip published as GitHub release asset

## Out of scope for Phase 5

- Mobile native app (PWA covers iOS/Android)
- Desktop wrap (Tauri) — defer to Phase 6 if demand
- Firefox / Safari / Edge extensions — Chrome-first; Firefox port is mostly mechanical (manifest tweaks) if requested later
- VS Code extension — never in our roadmap; refer users to OpenChamber
- Voice input / image attachments
- Multi-user (still single user per install; pairing is per-device not
  per-user)
- Search / history filters

## What Phase 5 teaches the Phase 3 Transport interface

Confirmed by this outline:
- `Card` model is fine; HTML-in-strings renders both via Telegram HTML parser
  and via DOM/`v-html`.
- `capabilities.streaming` flag is needed; without it, the relay would force
  Telegram-style edit-throttling on a transport that can do better.
- No new card fields needed for v0.5 (`title`, `lines`, `buttons`, `footer`
  cover all wireframe needs).
- Phase 4's tool-call inline rendering, /diff, /todo, /context all reuse via
  the relay → same data flows to both transports.

If Phase 5 brainstorm later reveals a need for new Card fields (e.g.,
"collapsible section" for tool details), bump to v0.6 minor instead of
modifying Phase 3 interface ahead of time.
