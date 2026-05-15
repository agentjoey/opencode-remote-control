# Sprint 001

Goal:      MVP — Telegram sidecar relay bot 交付到 launchd 自启
Period:    2026-05-15 ~ TBD
Version:   v0.1.0 (target)
Assignee:  subagent-driven execution (claude-sonnet-4-6 dispatch)

## 范围

执行 `docs/superpowers/plans/2026-05-15-opencode-remote-control.md` 的 Tasks 0-14：

| # | Task | 类型 | 状态 |
|---|------|------|------|
| 0 | Project scaffold | 基础 | ⏸ Pending |
| 1 | utils/markdown + 测试 | TDD | ⏸ Pending |
| 2 | utils/logger | 无测 | ⏸ Pending |
| 3 | config Zod schema + 测试 | TDD | ⏸ Pending |
| 4 | opencode/client + 测试 | TDD | ⏸ Pending |
| 5 | opencode/event-stream + 测试 | TDD | ⏸ Pending |
| 6 | opencode/tui-bridge + 测试 | TDD | ⏸ Pending |
| 7 | bot/reply + 测试 | TDD | ⏸ Pending |
| 8 | bot/handlers/chat | 集成 | ⏸ Pending |
| 9 | bot/handlers/approval | 集成 | ⏸ Pending |
| 10 | bot/handlers/commands | 集成 | ⏸ Pending |
| 11 | bot/index + src/index | 集成 | ⏸ Pending |
| 12 | tests/integration/live-opencode | 端到端 | ⏸ Pending |
| 13 | launchd plist 部署 | 部署 | ⏸ Pending |
| 14 | MVP 验收清单 13 项 | 手测 | ⏸ Pending |

## 验收（Sprint Done 标准）

- [ ] Tasks 0-14 全部 ✅
- [ ] `npm test` 全绿，≥30 单测
- [ ] launchd 安装并连续 24h 自动运行
- [ ] 至少一次真实远程开发用例验收

## Sprint 回顾
*完成后填写。*
