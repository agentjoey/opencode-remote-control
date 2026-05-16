# Current Status — opencode-remote-control

Version:        v0.3.0-rc.1
Sprint:         3 (Phase 3 — complete, pending tag)
Sprint File:    .agent/sprints/sprint-003.md
Last Updated:   2026-05-16

## Sprint 3 — Phase 3: Complete ✅

| Task | Status | Commit |
|------|--------|--------|
| **Task 1** core/types.ts (Card / Button / IncomingMessage / Capabilities) | ✅ | `2159b2a` |
| **Task 2** Transport interface | ✅ | `a847863` |
| **Task 3** SDK submitPrompt with agent/model overrides | ✅ | `c2011de` |
| **Task 4** file-backed SessionState (lastSessionId + nextAgent + nextModel) | ✅ | `b0c2fe4` |
| **Task 5** Move bot/reply.ts → transport/telegram/reply-stream.ts | ✅ | `3aef89f` |
| **Task 6** cardToTelegram render helper | ✅ | `7d4faf5` |
| **Task 7** core/relay.ts (SDK-native, channel-agnostic) | ✅ | `e0da870` |
| **Task 8** Config: TUI_VISIBLE, STATE_PATH, TRANSPORT | ✅ | `c2bef5e` |
| **Task 9** Telegram transport + handlers + delete src/bot/ | ✅ | `2314c5e` |
| **Task 10** Build verification | ✅ | — |
| **Task 11** 14.2 concurrent busy (transport-level guard) | ✅ | `5b9c355` |
| **Task 12** 14.11 network blip (EventStream reconnect) | ✅ | existing |
| **Task 13** 14.12 unauthorized user (whitelist middleware) | ✅ | `5b9c355` |
| **Task 14** 14.13 24h soak | ⏳ | manual — start soak now |
| **Task 15** LICENSE + SECURITY.md + README rewrite | ✅ | `042e37b` |
| **Task 16** CI + templates + CHANGELOG + CURRENT.md | ✅ | this commit |

Tests: **68 passing** · `npx tsc --noEmit` 无报错 · 11 test files

## Architecture changes

- `src/bot/` **removed** — replaced by `src/core/` + `src/transport/telegram/`
- Default submission: `client.session.prompt()` — TUI inject is opt-in (`TUI_VISIBLE=true`)
- `/agent` and `/model` are now **sticky per-message overrides** stored in persistent state
- `lastSessionId`, `nextAgent`, `nextModel` survive restarts via `data/state.json`

## Open questions (before tag)

1. **Public handle / author name** — for LICENSE and README byline (`<author-handle-to-confirm>`)
2. **Security contact email** — SECURITY.md (`<security-email-to-confirm>`)
3. **Final project / npm name** — keep `opencode-remote-control`?

## How to tag

```bash
git tag v0.3.0-rc.1
# DO NOT PUSH — wait for user review
```

## Key documents

- **Spec (Phase 3)**: `docs/superpowers/specs/2026-05-16-phase3-design.md`
- **Plan**: `docs/superpowers/plans/2026-05-16-phase3-implementation-plan.md`
- **Architecture**: `docs/ARCHITECTURE.md`
- **CHANGELOG**: `CHANGELOG.md`
