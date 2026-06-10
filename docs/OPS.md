# Operations Guide

> Runbook for the `opencode-remote-control` (ocrc) services.

## 进程结构（ocrc）

```
opencode serve --port 4096     ← AI 编码引擎（手动在目标项目目录启动）
         │
         ├── opencode attach http://localhost:4096   ← TUI（可选）
         │
         └── ocrc plugin (in-process)                ← Telegram + Web/PWA
```

v0.6.0 起 ocrc 作为 opencode 插件在同进程内运行（Telegram + Web）。

---

## ocrc Telegram Bot（legacy sidecar，launchd）

> 仅在以独立 sidecar 方式部署时适用。Plugin 模式随 `opencode` 启动，无需 launchd。

### 重启（代码变更后）

```bash
cd ~/AgentWorks/Code_Opencode/opencode-remote-control
npm run build
launchctl stop  ai.opencode.remote-control.telegram
launchctl start ai.opencode.remote-control.telegram
```

> `launchctl stop/start` 是正确用法；`bootout/bootstrap` 仅在 plist 未加载时使用。

### 状态 / 日志

```bash
launchctl list | grep ai.opencode.remote-control.telegram   # PID  退出码  Label
tail -f /tmp/opencode-remote-control-telegram.log            # stdout
tail -f /tmp/opencode-remote-control-telegram.err            # stderr
```

### 安装 / 卸载 plist

```bash
cp deploy/ai.opencode.remote-control.telegram.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
# 卸载
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
rm ~/Library/LaunchAgents/ai.opencode.remote-control.telegram.plist
```

---

## opencode（手动管理）

```bash
# 1. 在目标项目目录启动服务端
cd <your-project>
opencode serve --port 4096
# 2. 在任意终端打开 TUI（必须 attach，裸 opencode 会起独立进程，Bot 无法共享）
opencode attach http://localhost:4096
```

### 检查 / 关闭

```bash
ps aux | grep "opencode serve" | grep -v grep
lsof -i :4096
curl http://localhost:4096/global/health
curl http://localhost:4096/session          # session 列表
kill $(lsof -ti :4096)                        # 关服务端（TUI 自动断开）
```

---

## 构建 & 测试

```bash
cd ~/AgentWorks/Code_Opencode/opencode-remote-control
npm run build           # TypeScript 编译 → dist/
npm test                # 单元测试（vitest run）
npm run typecheck       # 只跑类型检查
cd web && npm run check && npm run build && npm run test
```

---

## 环境变量（.env，勿 commit）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TELEGRAM_BOT_TOKEN` | — | @BotFather 获取，勿泄露 |
| `ALLOWED_USER_IDS` | — | 逗号分隔的 Telegram user id（@userinfobot 获取） |
| `OPENCODE_BASE_URL` | `http://localhost:4096` | opencode serve 地址 |
| `LOG_LEVEL` | `info` | debug / info / warn / error |
| `TUI_VISIBLE` | `true` | 把对话同步到 TUI；`false` 走直连 API |
| `WEB_ENABLED` | `false` | 启用 Web 服务 |
| `WEB_HOST` | `127.0.0.1` | Web 绑定地址（隧道回源；勿对公网裸监听） |
| `WEB_PORT` | `7081` | Web 端口 |
| `WEB_CF_ACCESS_TEAM` | — | Cloudflare Access team 名 |
| `WEB_CF_ACCESS_AUD` | — | Cloudflare Access AUD tag |
| `WEB_CF_ACCESS_DEV_BYPASS` | `false` | 本地开发跳过 JWT（仅对 loopback 对端放行） |
| `TG_CHUNK_SOFT_LIMIT` | `3500` | 分页软限制（字符数） |

---

## 诊断速查

```bash
tail -f /tmp/opencode-remote-control-telegram.err   # bot 报错
curl http://localhost:4096/global/health            # opencode 健康
curl http://localhost:4096/session                  # 哪个 session busy
lsof -i :4096 -i :7081                               # 端口占用
```

---

## Web / PWA（Cloudflare Access）

Web 通过 cloudflared 隧道暴露，边缘用 **Cloudflare Access** 把关。装成桌面/手机
app(PWA)远程访问;鉴权走浏览器交互登录的 CF Access cookie。

### 启用 Web

```bash
# .env / opencode.json plugin options
WEB_ENABLED=true
WEB_HOST=127.0.0.1            # 隧道回源到本地；不要直接对公网监听
WEB_PORT=7081
WEB_CF_ACCESS_TEAM=<team>     # <team>.cloudflareaccess.com
WEB_CF_ACCESS_AUD=<app-aud>  # Access 应用的 Application Audience (AUD) tag
# 本地裸调试（无隧道）才需要，默认关闭：
# WEB_CF_ACCESS_DEV_BYPASS=true   # 仅对 loopback 对端放行
```

### Cloudflare Access 配置

1. 给隧道主机名建一个 Access 应用（**整站，路径留空**），记下 **AUD**（填到
   `WEB_CF_ACCESS_AUD`），策略 Allow 你的登录邮箱。
2. 浏览器打开该主机名 → 交互式登录 → cookie 自动带上(REST 和 WS 握手都带)。
   无需对 `/ws` 做任何特殊处理。
3. 为减少重登,把 Access 应用的 session duration 设长(单用户)。

> 不再需要 Service Token / `/ws` Bypass —— 那是已移除的浏览器扩展才需要的。

### 速查

```bash
lsof -i :7081                                        # Web 是否监听
curl -s https://<host>/api/logs | jq -r '.lines[]' | tail -50   # 应用内日志（需鉴权）
```
