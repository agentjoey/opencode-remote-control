# Product Backlog — opencode-remote-control

> 未排期任务池，按优先级排列。排入 Sprint 后从此处移除。
> 最后更新：2026-05-15

## 🔴 HIGH
*Sprint 1 完成 MVP 后再补充。*

## 🟡 MED — Phase 2 候选

- [ ] **`/files [query]` 文件浏览** — opencode `/find/file?query=` 包装到 Bot 命令
- [ ] **`/read <path>` 文件读取** — opencode `/file/content?path=` 包装
- [ ] **`/agent` 卡片选择** — InlineKeyboard 4 张卡片切换 Chat/Plan/Build/Audit
- [ ] **`/model list` + `/model set <provider/id>`** — 列出 + 切换当前 session 模型
- [ ] **主动推送 opencode 事件** — 文件 edit / git commit / test result 推到 Telegram

## 🟢 LOW

- [ ] **Tailscale 远程模式文档** — 不在本机时通过 Tailscale IP 访问 opencode
- [ ] **持久化 `lastSessionId`** — 进程重启后保留（当前 MVP 是内存变量）
- [ ] **/help 多语言** — 中文版本

## 📋 研究向（未决策）

- [ ] **Discord / Slack 通道** — umbrella scope 兑现，是否需要抽象 transport 层
- [ ] **Web 通道** — 浏览器扩展或 PWA 直连 opencode

## ✅ 已完成（按 Sprint 归档）
*Sprint 1 完成后归档。*
