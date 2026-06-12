# Decision: Cross-workspace streaming is not supported (accept the limit)

> Date: 2026-06-12
> Status: **Accepted** — defer; revisit if there's real demand.

## Problem

Sessions that live in a directory **other than the hub plugin's own directory** —
e.g. an `opencode` started in `~/AgentWorks` while the hub runs in
`…/opencode-remote-control` — get responses but **do not stream** to Web/Telegram,
and a separate TUI doesn't mirror them.

## Investigation (systematic-debugging, evidence-based)

| Finding | Evidence |
|---|---|
| The user's setup is **multi-process** (one `opencode` per directory) → **multiple separate servers** | `pid 70108` cwd `~/AgentWorks` distinct from the hub |
| A **TUI `opencode` cannot even submit** to a session outside its own directory | driving a hub-created `/tmp` session produced **no `submitting` log** — `client.session.get` hangs (sessions are directory-bound to a live server) |
| `opencode serve` **can** submit cross-directory (multi-dir) and exposes a **reachable API port** | a throwaway serve prompted a repo-dir session fine; listened on `:39094` |
| **`client.global.event()` connects but delivers ZERO events inside the plugin worker** — even in serve | instrumented probe: `PROBE global recv` count = **0** after a cross-dir prompt |
| The per-instance `event` hook is **directory-scoped** | PRIMARY plugin binds to the first instantiated directory; cross-dir events never fire it |
| Plugin loads **per-directory-instance, on demand**; first = PRIMARY, rest PASSIVE | serve log: `became PRIMARY` then `another PRIMARY alive (same pid) → PASSIVE` |

## Root cause

The hub plugin can **list/read** cross-directory sessions (shared sqlite db) but cannot
**stream** them, because **no event path delivers cross-directory events into the plugin
worker**:

1. The per-instance `event` hook (the only path that works in the worker) is **directory-scoped**.
2. `client.global.event()` — the cross-instance stream that *does* carry every directory's
   events over HTTP — **connects but delivers nothing when consumed inside opencode's plugin
   worker** (verified in both TUI and serve). This is an opencode-runtime SSE-in-worker
   behavior, not a logic bug in this project.

`opencode serve` fixes the *submit* hang (it is multi-directory) but **not** the streaming,
because the same in-worker SSE delivery is broken.

## Decision

**Accept the limitation.** Cross-workspace/cross-process sessions remain **listable and
readable** but **not live-streamable**. Drive active development from the hub's own directory.

## If revisited later — candidate approaches

1. **Sidecar event relay (architecture-level).** `opencode serve` exposes a reachable API
   port, and the HTTP `global.event` stream **works from a normal process** (verified). A
   small standalone process could subscribe to `serve`'s `global.event` over HTTP and feed
   events into the Web/Telegram pipeline — moving event-reception out of the broken worker
   SSE. Biggest change; the only path seen that could actually work.
2. **Upstream fix.** Get opencode to deliver `client.global.event()` (or a per-server event
   hook) inside the plugin worker. Out of our control.
3. **Single-directory hub only.** Document "run one opencode in your active project dir" as
   the supported model.

## Related

- The per-instance `event` hook (not the pulled global SSE) is the reliable in-worker
  dispatch source — see commit `6eeab76` (P1 hotfix) and `src/plugin/entry.ts`.
