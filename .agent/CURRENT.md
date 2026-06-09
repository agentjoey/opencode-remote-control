# Current Status — opencode-remote-control

Version:        v0.6.0-rc.1
Last Updated:   2026-06-09

## Recent work (v0.5.7 → v0.6.0-rc.1)

### Plugin Registry Migration
- **Plugin entry** — `src/plugin/entry.ts` exports `remoteControlPlugin: Plugin`,
  auto-starts Telegram bot + Web UI when opencode loads the plugin
- **Plugin config** — `src/plugin/config.ts` reads env from opencode process
- **Relay adaptation** — `handleEvent()` method for event-hook mode; `eventStream`
  and `baseUrl` made optional in `RelayDeps`
- **Transport adaptation** — `TelegramConfig` and `WebTransportConfig` now have
  optional `baseUrl`/`eventStream` params
- **CLI install** — `npx opencode-remote-control install` with interactive prompts
  or `--yes` CI mode, `--local` for project config
- **CLI uninstall** — `npx opencode-remote-control uninstall`
- **rc-status tool** — visible in opencode TUI, shows version + transport status
- **Package reconfig** — `@opencode-ai/plugin` dep, `./plugin` `./install` `./uninstall`
  exports, removed `engines.node` restriction

### Docs & Specs
- `docs/superpowers/specs/2026-05-31-phase6-plugin-migration-design.md`
- `docs/superpowers/plans/2026-05-31-phase6-plugin-migration.md`
- `ARCHITECTURE.md` updated for Plugin mode
- `CHANGELOG.md` v0.6.0-rc.1 entry
- Obsidian: `ACTIVE.md` / `ROADMAP.md` synced to v0.5.7
- Obsidian: `research/opencode-mobile-analysis.md` — doza62/opencode-mobile analysis
- Obsidian: `design/plugin-registry-migration.md` — MCP vs Plugin comparison

## Test status
- **144 tests passing** (26 files)
- `npx tsc --noEmit` clean
- `npm run build` → `dist/` (plugin, cli, core all built)

## Key decisions
- **Plugin Registry** as primary deployment — one `npx install`, auto-starts with opencode
- **Legacy sidecar preserved** — `RC_MODE=legacy` or `src/index.ts` direct invocation
- **MCP evaluated but rejected** — Plugin pattern is the right fit for long-lived
  services (Telegram bot, Web server); MCP only suitable for management tools
- **doza62/opencode-mobile** analyzed as reference implementation — tunnel fallback,
  install UX, session enrichment, childSession filtering identified as P0-P3 learnings
- **openCode Plugin API** fully sufficient: `ctx.client` is full SDK client,
  `event` hook covers all session/message events, can start HTTP/WS servers
