# Operations Guide

## 服务全景

本机共运行以下服务，分三个项目：

```
┌─── ocrc (opencode-remote-control) ────────────────────────────┐
│  ai.opencode.remote-control.telegram   Telegram Bot (launchd)  │
│  [待配置] web service                  Web PWA (未启用)         │
└────────────────────────────────────────────────────────────────┘

┌─── opencode (手动启动，不受 launchd 管理) ──────────────────────┐
│  opencode serve --port 4096            AI 编码服务端             │
│  opencode attach http://localhost:4096 TUI 客户端                │
└────────────────────────────────────────────────────────────────┘

┌─── REDACTED-PROJECT ─────────────────────────────────────────────┐
│  com.REDACTED.agent                 AI 交易 Agent (launchd)  │
│  com.REDACTED.telegram              交易 Telegram Bot (launchd)│
│  com.REDACTED.cloudflared           CF Tunnel (launchd)       │
└────────────────────────────────────────────────────────────────┘

┌─── 基础设施 ───────────────────────────────────────────────────┐
│  REDACTED.cloudflared                  REDACTED 通用 CF Tunnel   │
│    ├── REDACTED-HOST  → SSH :22                              │
│    └── REDACTED-HOST → VNC :REDACTED-PORT                        │
│  ai.REDACTED.gateway                   REDACTED 网关 :REDACTED-PORT       │
│  ai.REDACTED.gateway                     REDACTED 网关               │
│  com.REDACTED.backup                   定时备份（每日 0:00）     │
│  com.REDACTED.REDACTED          OpenRouter 扫描（每日 8:00）│
└────────────────────────────────────────────────────────────────┘
```

---

## 进程结构（ocrc）

```
opencode serve --port 4096     ← AI 编码引擎（手动在目标项目目录启动）
         │
         ├── opencode attach http://localhost:4096   ← TUI（可选）
         │
         └── node dist/index.js                      ← Telegram Bot（launchd）
```

---

## 服务状态速查

```bash
# 查看所有 launchd 服务状态（PID | 退出码 | Label）
launchctl list | grep -E "opencode|REDACTED|cloudflared|REDACTED|REDACTED"

# 重点关注字段：
#   PID 有值  = 正在运行
#   -         = 未运行
#   退出码 非0 = 上次异常退出（需查日志）
```

---

## ocrc Telegram Bot

### 重启（代码变更后的标准流程）

```bash
cd ~/AgentWorks/Code_Opencode/opencode-remote-control
npm run build
launchctl stop  ai.opencode.remote-control.telegram
launchctl start ai.opencode.remote-control.telegram
```

> **注意**：`launchctl stop/start` 是正确用法。`bootout/bootstrap` 仅在 plist 未加载时使用。

### 查看状态

```bash
launchctl list | grep ai.opencode.remote-control.telegram
# 输出：PID  退出码  Label
```

### 日志

```bash
tail -f /tmp/opencode-remote-control-telegram.log   # stdout
tail -f /tmp/opencode-remote-control-telegram.err   # stderr（报错看这里）
```

### 安装 / 卸载 plist

```bash
# 安装（初次部署，只需一次）
cp deploy/ai.opencode.remote-control.telegram.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist

# 卸载
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
rm ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
```

> **已安装的 plist 与 deploy/ 模板差异**：
> - `~/Library/LaunchAgents/` 安装版：使用 `dist/index.js`（当前生效）
> - `deploy/ai.opencode.remote-control.telegram.plist`：模板里是 `dist/launcher.js`（待统一）

---

## opencode（手动管理）

### 启动

```bash
# 1. 在目标项目目录启动服务端
cd ~/AgentWorks/YourProject
opencode serve --port 4096

# 2. 在任意终端打开 TUI
opencode attach http://localhost:4096
```

> **必须用 `attach`**，裸 `opencode` 会起独立进程，Bot 无法共享。

### 检查

```bash
# 服务端在哪个目录运行？
ps aux | grep "opencode serve" | grep -v grep
lsof -p $(pgrep -f "opencode serve") | grep cwd

# 端口占用
lsof -i :4096

# 健康检查
curl http://localhost:4096/global/health

# Bot 连接后，测试 session 列表
curl http://localhost:4096/session
```

### 关闭

```bash
kill $(lsof -ti :4096)        # 关服务端（TUI 自动断开）
# TUI 窗口直接 Ctrl-C 或 q
```

---

## REDACTED-PROJECT

```bash
# 重启交易 Agent
launchctl stop  com.REDACTED.agent
launchctl start com.REDACTED.agent
tail -f ~/AgentWorks/Code_Claude/REDACTED-PROJECT/data/agent.log

# 重启交易 Telegram Bot
launchctl stop  com.REDACTED.telegram
launchctl start com.REDACTED.telegram
tail -f ~/AgentWorks/Code_Claude/REDACTED-PROJECT/data/telegram.log

# 重启 REDACTED-PROJECT CF Tunnel
launchctl stop  com.REDACTED.cloudflared
launchctl start com.REDACTED.cloudflared
tail -f ~/AgentWorks/Code_Claude/REDACTED-PROJECT/data/cloudflared.log
```

---

## Cloudflare Tunnel（REDACTED）

**Tunnel ID**: `REDACTED-TUNNEL-ID`
**Config**: `~/.cloudflared/REDACTED.yml`

当前 ingress 规则：
| hostname | service |
|---|---|
| `REDACTED-HOST` | SSH :22 |
| `REDACTED-HOST` | VNC :REDACTED-PORT |

```bash
# 重启
launchctl stop  REDACTED.cloudflared
launchctl start REDACTED.cloudflared
tail -f ~/.cloudflared/logs/REDACTED.log

# 添加 ocrc web 入口后需要修改 REDACTED.yml，然后重启
# 在 ingress 列表末尾（404 规则之前）添加：
#   - hostname: REDACTED-HOST
#     service: http://localhost:7081
```

---

## 代码变更后"需要重启什么"

| 改动范围 | 需要重启 |
|---|---|
| ocrc 代码（`src/`）| `npm run build` → 重启 `ai.opencode.remote-control.telegram` |
| ocrc Web 端（待启用）| `npm run build` → 重启 web service（plist 待创建） |
| REDACTED-PROJECT Agent 代码 | 重启 `com.REDACTED.agent` |
| REDACTED-PROJECT TG Bot 代码 | 重启 `com.REDACTED.telegram` |
| REDACTED CF Tunnel 配置 | 重启 `REDACTED.cloudflared` |
| opencode 本身版本更新 | 手动重启 `opencode serve`（关旧端口，重新启动） |

---

## 构建 & 测试

```bash
cd ~/AgentWorks/Code_Opencode/opencode-remote-control

npm run build           # TypeScript 编译 → dist/
npm test                # 144 unit tests（vitest run）
npm run typecheck       # 只跑类型检查，不输出文件
```

---

## 环境变量（.env，勿 commit）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TELEGRAM_BOT_TOKEN` | — | @BotFather 获取，勿泄露 |
| `ALLOWED_USER_ID` | — | @userinfobot 获取 |
| `OPENCODE_BASE_URL` | `http://localhost:4096` | opencode serve 地址 |
| `LOG_LEVEL` | `info` | debug / info / warn / error |
| `TUI_VISIBLE` | `true` | bot 把对话同步到 TUI（select-session + appendPrompt）；`false` 完全脱离 TUI 走直连 API |
| **Web（Phase 5 待配置）** |||
| `WEB_ENABLED` | `false` | 启用 Web 服务 |
| `WEB_HOST` | `127.0.0.1` | Web 绑定地址 |
| `WEB_PORT` | `7081` | Web 端口 |
| `WEB_STATIC_ROOT` | `web/dist` | PWA 静态文件路径 |
| `WEB_CF_ACCESS_TEAM` | — | Cloudflare Access team 名 |
| `WEB_CF_ACCESS_AUD` | — | Cloudflare Access AUD tag |
| `WEB_CF_ACCESS_DEV_BYPASS` | `false` | 本地开发跳过 JWT |
| `WEB_CF_ACCESS_DEV_EMAIL` | `dev@localhost` | 开发 bypass 邮箱 |
| **Telegram** |||
| `TG_CHUNK_SOFT_LIMIT` | `3500` | 分页软限制（字符数） |
| `TG_CHUNK_HARD_LIMIT` | `3900` | 分页硬限制（字符数） |
| `SSE_HEARTBEAT_MS` | `30000` | SSE 心跳超时（毫秒），超时无事件则重连 |

---

## Changelog

### v0.5.7 (2026-05-21)
- **Telegram 流式移除** — 删除 renderStreaming/renderThinking/retryEdit，只发 final 结果
- **Delta 累积修复** — `partTextAcc` Map 增量追加而非覆盖，根治截断
- **空 text 防护** — accumulator 跳过 `text=""` 更新，防止内容清空
- **TCP 超时保护** — 所有 sendMessage 加 10s timeout（sendTimed/withTimeout）
- **429 retry_after 封顶** — 超过 5s 直接 fallback 到 sendMessage
- **Thinking 卡片时序** — sessionId 解析完后才发布，消除 earlySessionId 不一致
- **push 空摘要重试** — fetchSummary 空时 3s 后重试一次
- **UI 清理** — 移除 Stop 按钮、Part N 头；continuation 显示 ⏳
- **sendInfo 重试** — ECONNRESET 时 3 次重试（2s 间隔）

### v0.5.6 (2026-05-20)
- Delta 累积基础修复（accumulator 替换逻辑）
- renderer retryEdit fallback
- 空 text overwrite 防护

### v0.5.5 (2026-05-17)
- Card.svelte 补全 7 种 kind 分发（thinking/streaming/assistant/error/info/status/user）
- WS 重连后自动重新订阅当前 session（`onReconnect` 回调）
- Extension 侧边栏 WS 消息处理补全（appendCard / subscribe / onReconnect）
- info 类型同步 sessionId? 字段
- Extension manifest 自动同步版本号 + 新增 CSP
- relay tools 去重（按 part.id，无 id 时按 tool+args）
- 前端类型复用后端（$shared alias → svelte.config.js kit.alias）
- hello WS 消息注入真实 session 列表
- SPA fallback 改用 existsSync 精确匹配文件
- streaming 去重仅当 markdownSrc 或 tools 变化时替换
- card-bus 异常日志附加 kind + sessionId
- 审批按钮改用 SDK permissionRespond（修复 "expired" 问题）
- push 通知修复：bot 重启 mid-session 时补录 busySince（session 完成仍能推送）
- EventStream 重连后对已 busy session 也发 synthetic busy 事件

### v0.5.4 (2026-05-17)
固定 bug 修复：审批按钮失效、push 通知漏发

### v0.5.3 (2026-05-17)
push 通知获取中文摘要、timeout 不当错误

### v0.5.2 (2026-05-17)
统一 Part 头格式、collapseTools running 位置修复、分页爆炸修复

### v0.5.1 (2026-05-16)
WS 零认证修复、push CardBus 重构、isLoopback fail-open 修复

### v0.5.0 (2026-05-16)
Phase 5: Web UI (PWA + Chrome Extension)、CardBus 重构、Telegram 流式分页

---

## 诊断速查

```bash
# Bot 有没有在处理消息？
tail -f /tmp/opencode-remote-control-telegram.err

# opencode 健康
curl http://localhost:4096/global/health

# 哪个 session 当前 busy？
curl http://localhost:4096/session

# TUI 有没有附着（有 TUI 则 hang；无 TUI 立即返回）
curl -m 2 http://localhost:4096/tui/control/next

# 端口占用总览
lsof -i :4096 -i :7081 -i :REDACTED-PORT
```
