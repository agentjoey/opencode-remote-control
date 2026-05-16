# Phase 5 Acceptance Checklist

## Test Results

| Suite | Files | Tests | Status |
|---|---|---|---|
| Root unit | 24 | 133 | ✅ PASS |
| Web unit | 2 | 4 | ✅ PASS |
| Web build | — | — | ✅ PASS |
| Extension build | — | — | ✅ PASS |
| Root typecheck | — | — | ✅ PASS |

## Tasks Completed

- [x] Task 1: `StructuredCard` 8-variant discriminated union
- [x] Task 2: `CardBus` with ring buffer + error isolation
- [x] Task 3: `history.ts` message reconstruction
- [x] Task 4: Revised `Transport` interface
- [x] Task 5: Relay refactor (CardBus publish)
- [x] Task 6-9: Telegram adaptive throttle + progressive collapse + pagination
- [x] Task 10: Telegram CardBus wiring
- [x] Task 11: Push notifications via CardBus
- [x] Task 12: Integration test (15000+ char pagination)
- [x] Task 13-20: Web backend (Hono, CF Access, WS, routes)
- [x] Task 21: SvelteKit init
- [x] Task 22-28: Web frontend (WS client, API, stores, components, routes, PWA)
- [x] Task 29: PWA manifest + service worker + icons
- [x] Task 30-31: Chrome MV3 extension (side panel, context menu, popup)
- [x] Task 32: README + ARCHITECTURE.md + OPS.md updates
- [x] Task 33: CI workflow (web build + tests)
- [x] Task 34: Playwright E2E placeholder (marked 需要手动验证)
- [x] Task 35: Acceptance checklist + tag

## Known Issues / Notes

1. **svelte-check false positives**: `$app/stores` and `$app/navigation` show as
   "Cannot find module" in `svelte-check` because SvelteKit ambient types are
   generated at build time. `npm run build` succeeds; these are tooling quirks.

2. **Extension build**: Uses standalone `App.svelte` instead of SvelteKit routes
   to avoid `$app/*` dependency. Extension loads the same components but mounts
   them directly.

3. **E2E tests**: Skipped pending manual verification with real opencode server.

## Tag

```bash
git tag -a v0.5.0 -m "Phase 5: Web UI (PWA + Chrome Extension), CardBus refactor, Telegram streaming overflow fix"
```

## Next Phase

- Voice / image attachments
- Multi-user support
- Firefox/Edge extension ports
- VS Code extension
