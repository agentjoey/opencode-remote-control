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
| `WEB_PORT` | `17081` | Web 端口（opencode 1.17 自身占用 `7081`） |
| `WEB_AUTH` | `token` | 认证策略：`token`（默认，免 CF Access）/ `cf-access` |
| `WEB_TOKEN` | 自动 | 留空则自动生成并持久化到 `~/.opencode/oprc-token`（`0600`） |
| `WEB_PUBLIC_URL` | — | 配对链接/二维码用的公开地址；未设则自动探测 cloudflared，再退回 LAN/loopback |
| `WEB_CF_ACCESS_TEAM` | — | Cloudflare Access team 名（仅 `WEB_AUTH=cf-access`） |
| `WEB_CF_ACCESS_AUD` | — | Cloudflare Access AUD tag（仅 `WEB_AUTH=cf-access`） |
| `WEB_CF_ACCESS_DEV_BYPASS` | `false` | 跳过认证，仅对 loopback 对端放行。**隧道后必须 false**（cloudflared 走 loopback） |
| `TG_CHUNK_SOFT_LIMIT` | `3500` | 分页软限制（字符数） |

---

## 诊断速查

```bash
tail -f /tmp/opencode-remote-control-telegram.err   # bot 报错
curl http://localhost:4096/global/health            # opencode 健康
curl http://localhost:4096/session                  # 哪个 session busy
lsof -i :4096 -i :17081                              # 端口占用
```

---

## Web / PWA

Web 通过隧道/VPN 暴露,装成桌面/手机 app(PWA)远程访问。默认用 **token** 认证
(免 Cloudflare Access);CF Access 作为可选策略保留。

### 启用 Web

```bash
# .env / opencode.json plugin options
WEB_ENABLED=true
WEB_HOST=127.0.0.1            # 隧道回源到本地；不要直接对公网监听
WEB_PORT=17081               # opencode 1.17 自身占用 7081
WEB_AUTH=token               # 默认；免 CF Access
WEB_PUBLIC_URL=https://<host>  # 配对链接用；未设则自动探测 cloudflared
WEB_CF_ACCESS_DEV_BYPASS=false # 隧道后必须 false（cloudflared 走 loopback，否则全放行）
```

### Token 认证 + 配对(默认)

```bash
oprc pair                    # 打印 URL + 二维码（token 在 #fragment）
# 或 Telegram 发 /pair
```

1. 浏览器打开 `https://<host>/#token=…` → app 存下 token、抹掉 fragment、正常加载。
2. token 持久化在 `~/.opencode/oprc-token`,重启/重装不变。轮换:`rm` 该文件再重启。
3. 配对链接的 host:优先 `WEB_PUBLIC_URL`,否则自动读 `~/.cloudflared/*.yml` 的
   ingress 域名,再退回 LAN/loopback。

### 远程访问(无自有域名)

PWA 安装需要**安全上下文**(HTTPS 或 `http://localhost`)。任选其一:

| 方式 | 命令 | 说明 |
|---|---|---|
| Tailscale(推荐) | `tailscale serve 17081` | 稳定 `https://<host>.ts.net`,设备级认证 |
| cloudflared 快速隧道 | `cloudflared tunnel --url http://localhost:17081` | 免费 `*.trycloudflare.com`,URL 每次变 |
| SSH 端口转发 | `ssh -L 17081:localhost:17081 <host>` | 然后开 `http://127.0.0.1:17081` |

> 纯 `http://<内网IP>` 不是安全上下文 —— Chrome 不让装 app、也不注册 SW。

### Cloudflare Access(可选)

`WEB_AUTH=cf-access` + `WEB_CF_ACCESS_TEAM`/`WEB_CF_ACCESS_AUD`:给隧道主机名建一个
整站 Access 应用(路径留空),记下 AUD,策略 Allow 你的邮箱。浏览器交互登录后 cookie
自动带上(REST + WS 握手都带),无需对 `/ws` 特殊处理。

### 前端更新与缓存

更新前端/图标只需 `cd web && npm run build` + 重启 hub。CF 已配 **Cache Rule**:
`/service-worker.js`、`/manifest.webmanifest`、`/icon-*`、`/apple-touch-icon.png`、
`/favicon.png` 边缘 **bypass cache**(回源取最新),所以**无需手动 purge**。带 hash 的
`_app/*` 资源仍走长缓存(文件名带 hash,天然安全)。SW 预缓存用 `cache:'reload'`,不会
被浏览器 HTTP 缓存污染。

> 浏览器若仍显示旧 SW:Application → Service Workers → Unregister(只清 SW,**别**用
> Clear site data —— 那会连 localStorage 里的 token 一起清掉,需要重新 `/pair`)。

### 速查

```bash
lsof -i :17081                                       # Web 是否监听
curl -s https://<host>/api/logs | jq -r '.lines[]' | tail -50   # 应用内日志（需鉴权）
```
