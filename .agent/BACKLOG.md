# Product Backlog — opencode-remote-control

> 未排期任务池，按优先级排列。排入 Sprint 后从此处移除。
> 最后更新：2026-06-09 02:35

## 🔴 HIGH

- [ ] **Web 多 session 支持** — 当前 Web 端仅展示单一 session，需支持 session 列表切换、多 session 同步，与 TUI / Telegram 三端 session 状态一致。
- [ ] **Web 外网访问** — 已有 Cloudflare Access Tunnel 方案（`WEB_CF_ACCESS_*` 配置），需实现完整的 tunnel 部署与自动重连。
- [ ] **Telegram 自动跟随 TUI session** — 当前用户在 TUI 切换 session 后，Telegram 端不会自动跟随，需手动 `/session switch`。应将 `tui.session.select` 事件同步到 relay 的 session 路由逻辑，使 Telegram 消息自动发往 TUI 当前所在 session。
- [ ] **安全加固：Bot token 迁移到 shell 环境变量** — 当前明文存储于 `~/.config/opencode/opencode.json`。建议：`export TELEGRAM_BOT_TOKEN=xxx` 写入 `.zshrc`，从 opencode.json 中移除，降低凭证泄露风险。验证：plugin 模式需确认 `process.env.TELEGRAM_BOT_TOKEN` 可以从 shell env 读取。
- [ ] **opencode-remote-control 改为全局生效** — 当前仅在本项目 `opencode.json` 的 `plugin` 字段以绝对路径注册，需手动复制到每个项目。目标：从项目 opencode.json 移除，迁移到 `~/.config/opencode/opencode.json` 的全局 plugin，使所有项目自动加载。选项：(a) 直接写绝对路径进全局配置（简单、路径写死）；(b) 通过 `npm i -g` + 包内 install 脚本注册（迁移/升级更稳健，需先 build & link 或发布）。

## 🟡 MED — 待排期

- [ ] **`/files [query]` 文件浏览** — opencode `/find/file?query=` 包装到 Bot 命令
- [ ] **`/read <path>` 文件读取** — opencode `/file/content?path=` 包装
- [ ] **主动推送 opencode 事件** — 文件 edit / git commit / test result 推到 Telegram

## 🟢 LOW

- [ ] **Tailscale 远程模式文档** — 不在本机时通过 Tailscale IP 访问 opencode
- [ ] **/help 多语言** — 中文版本

## 📋 研究向（未决策）

- [ ] **Discord / Slack 通道** — umbrella scope 兑现，是否需要抽象 transport 层
- [ ] **Web 通道** — 浏览器扩展或 PWA 直连 opencode

## ✅ 已完成

### Sprint 1 — Phase 1 MVP
- Sidecar Telegram bot, TUI inject, SSE event stream, approval cards, launchd deploy

### Sprint 2 — Phase 2: Command Cards + Streaming
- F5: /session pin/unpin + registerCallbacks() architecture
- 命令卡片化: /status, /start, /help, /current all HTML cards
- F2: /files 命令（tool + patch part）
- F3: /agent 命令（list + 创建 session 切换）
- F4: /model 命令（list + PATCH /config 切换）
- F1: 流式输出（message.part.delta 实时推送）
