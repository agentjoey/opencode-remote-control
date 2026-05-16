# Operations Guide

## 进程结构

三个独立进程，彼此通过 HTTP 连接：

```
opencode serve --port 4096     ← AI 编码引擎（在目标项目目录下启动）
         │
         ├── opencode attach http://localhost:4096   ← TUI（可选，任意目录）
         │
         └── node dist/index.js                      ← Telegram Bot（在本项目目录下）
```

---

## 日常启动

### 1. 启动 opencode 服务端（在你要开发的项目目录下）

```bash
cd ~/AgentWorks/YourProject
opencode serve --port 4096
```

> 如果 4096 被占用，先检查 `lsof -i :4096`，再 `kill <PID>`。

### 2. 打开 TUI（任意终端窗口）

```bash
opencode attach http://localhost:4096
```

> **必须用 `attach`，不能直接跑 `opencode`**。裸 `opencode` 会启动独立进程，和 bot 共享不了 server。

### 3. 启动 Telegram Bot

```bash
cd ~/AgentWorks/Code_Opencode/opencode-remote-control
node dist/index.js
```

或后台运行：

```bash
node dist/index.js >> /tmp/orc-bot.log 2>&1 &
echo "bot PID: $!"
```

---

## 关闭

```bash
# 关 bot（前台直接 Ctrl-C；后台：）
pkill -f "node.*dist/index"

# 关 TUI（Ctrl-C 或 q）

# 关 opencode serve
pkill -f "opencode serve"
# 或定向 kill:
kill $(lsof -ti :4096)
```

---

## launchd 自动启动（安装后）

```bash
# 安装（只需做一次）
cp deploy/ai.opencode.remote-control.telegram.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist

# 手动启停
launchctl start ai.opencode.remote-control.telegram
launchctl stop  ai.opencode.remote-control.telegram

# 卸载
launchctl unload ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
rm ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist

# 查看状态 / PID
launchctl list | grep ai.opencode.remote-control.telegram

# 查看日志
tail -f /tmp/opencode-remote-control-telegram.log
tail -f /tmp/opencode-remote-control-telegram.err
```

---

## 诊断

```bash
# opencode 服务端在跑吗？工作目录正确吗？
ps aux | grep "opencode serve" | grep -v grep
lsof -p $(pgrep -f "opencode serve") | grep cwd

# 哪个进程占用 4096？
lsof -i :4096

# bot 在跑吗？
pgrep -f "node.*dist/index" && echo "running"

# bot 实时日志
tail -f /tmp/orc-bot.log

# opencode 健康检查
curl http://localhost:4096/global/health

# 当前 session 状态
curl http://localhost:4096/session/status

# TUI 控制队列是否有消费者（有 TUI 附着则会 hang；立即返回则无 TUI）
curl -m 2 http://localhost:4096/tui/control/next
```

---

## 重建 bot

```bash
cd ~/AgentWorks/Code_Opencode/opencode-remote-control
npm run build        # = npx tsc
npm test             # 44 unit tests
```

---

## 环境变量（.env）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TELEGRAM_BOT_TOKEN` | — | @BotFather 获取 |
| `ALLOWED_USER_ID` | — | @userinfobot 获取 |
| `OPENCODE_BASE_URL` | `http://localhost:4096` | opencode serve 地址 |
| `LOG_LEVEL` | `info` | debug / info / warn / error |
| **Web** |||
| `WEB_ENABLED` | `false` | 启用 Web 服务 |
| `WEB_HOST` | `127.0.0.1` | Web 绑定地址 |
| `WEB_PORT` | `7081` | Web 端口 |
| `WEB_STATIC_ROOT` | `web/dist` | PWA 静态文件路径 |
| `WEB_CF_ACCESS_TEAM` | — | Cloudflare Access team 名 |
| `WEB_CF_ACCESS_AUD` | — | Cloudflare Access AUD tag |
| `WEB_CF_ACCESS_DEV_BYPASS` | `false` | 本地开发跳过 JWT |
| `WEB_CF_ACCESS_DEV_EMAIL` | `dev@localhost` | 开发 bypass 邮箱 |
| **Telegram** |||
| `TG_CHUNK_SOFT_LIMIT` | `3500` | 分页软限制 |
| `TG_CHUNK_HARD_LIMIT` | `3900` | 分页硬限制 |
