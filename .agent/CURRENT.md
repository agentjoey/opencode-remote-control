# Current Status — opencode-remote-control

Version:        v0.1.0-rc.1
Sprint:         1
Sprint Status:  🟢 Code complete, awaiting user MVP acceptance (Task 14)
Last Updated:   2026-05-15 by claude-sonnet-4-6
Sprint File:    .agent/sprints/sprint-001.md

## Open Bugs（P0/P1 必须本 Sprint 修复）
🟢 无（37 tests passing；最终 review 发现的 2 个真 bug 已修复 in ec43fef）

## Current Sprint Summary
Sprint 1 实施完成：Tasks 0-13 全部交付，37 unit tests 全绿，typecheck 干净。剩 Task 14（MVP 手测验收）待用户执行。

### 已完成（14 commits + spec/plan）
- Tasks 0-1: scaffold + markdown utils（TDD）
- Tasks 2-3: logger + config（Zod）
- Tasks 4-6: opencode/client + event-stream + tui-bridge（TDD，含 race condition fix）
- Tasks 7-10: bot/reply + chat + approval + commands handlers
- Task 11: bot/index + src/index 装配 + polling 重试
- Task 12: tests/integration/live-opencode.test.ts（契约测试）
- Task 13: deploy/ai.opencode.remote-control.telegram.plist（未安装）

### 待执行（用户）
- Task 14: MVP 13 项手测验收清单（详见 plan §Task 14）

## Next Sprint Candidates
- [ ] [Phase 2] `/files [query]` / `/read <path>` 文件浏览命令
- [ ] [Phase 2] `/agent` 卡片选择 4 个自定义 agent
- [ ] [Phase 2] `/model list` / `/model set` 模型切换
- [ ] [Phase 2] opencode 重要事件主动推送（编辑文件、提交、测试结果）
- [ ] [Phase 2] Tailscale 远程模式（不在本机时也能用）
- [ ] [Phase 3 候选] Discord / Web 通道（umbrella scope 兑现）

## 关键文档
- **Spec（架构权威）**：`docs/superpowers/specs/2026-05-15-opencode-remote-control-design.md`
- **Plan（实施清单）**：`docs/superpowers/plans/2026-05-15-opencode-remote-control.md`
- **Obsidian 高级别记录**：`P023-OpencodeRemoteControl/`

## 用户 MVP 验收前置步骤

1. **创建 Telegram Bot** — 在 Telegram 找 @BotFather，`/newbot`，获取 token
2. **获取自己的 user ID** — 在 Telegram 找 @userinfobot，`/start`，记下 `Id:`
3. **写 .env 文件** — 在项目根 `cp .env.example .env`，填 `TELEGRAM_BOT_TOKEN` + `ALLOWED_USER_ID`
4. **构建** — `npm run build`
5. **手动启动验证** — `npm start`（确认本机 opencode TUI 已在 :4096 运行）
6. **安装 launchd**（验证通过后）：
   ```bash
   cp deploy/ai.opencode.remote-control.telegram.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
   launchctl start ai.opencode.remote-control.telegram
   ```
7. **跑 13 项验收清单** — 见 plan §Task 14
