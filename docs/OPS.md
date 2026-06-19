# Operations Guide

> Runbook for the `opencode-remote-control` (ocrc) services.

## 新设备 / 新用户安装

> OCRC **没有发布到 npm**（npm 上的同名包是别人的，别 `npx`）。安装 = git clone 构建。

### 前置依赖
| 依赖 | 必需性 | 备注 |
|---|---|---|
| Node.js 20+ | 必需 | 运行时 |
| opencode 1.17+ | 必需 | AI 引擎（plugin 模式宿主；host 模式的 opencode 后端也用） |
| Telegram bot | Telegram 通道需要 | [@BotFather](https://t.me/BotFather) 建 bot 拿 token；[@userinfobot](https://t.me/userinfobot) 拿数字 user id |
| ACP agent（如 kimi） | 仅 host 模式用 ACP 时 | 装好 CLI + 登录一次（`kimi login`） |

### 模式 A — Plugin（默认，只控 opencode）
```bash
git clone https://github.com/agentjoey/opencode-remote-control
cd opencode-remote-control
npm install && npm run build:all
node dist/cli/install.js        # 交互：粘贴 Telegram bot token + user id
opencode serve --port 4096      # 或正常启动 opencode —— 插件自动加载
```
`install.js` 写插件桥接到 `~/.config/opencode/plugins/`、配置到 `.env`。
Web 默认开启 → `node dist/cli/index.js pair`（或 Telegram `/pair`）配对设备。

### 模式 B — Standalone host（opencode + ACP 多后端）
见下方「Standalone host 模式」+「launchd 自启服务」。一句话：
`cp .env.acp.example .env.acp` → 填 `WEB_TOKEN` + `OCRC_BACKENDS` →
`scripts/run-acp-host.sh`（或装 launchd 服务常驻）。

### 公网访问（手机 PWA 需 HTTPS）
`localhost` 仅本机有效。手机装 PWA 需 HTTPS → 挂隧道：cloudflared（自有域名）/
`tailscale serve <port>` / `cloudflared tunnel --url http://localhost:<port>`（临时）。

### 备注
- `oprc` 默认不在 PATH：用 `node dist/cli/index.js <cmd>`，或 `npm link` 拿 `oprc`。
- `init` 向导把 Telegram token **明文写进 `.env`**（已 gitignore）。生产可加固：
  存 macOS Keychain，`.zshrc` 里 `security find-generic-password` 取（见现有部署）。

---

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

## 安装 / 更新 / 重启（plugin 模式）

```bash
# 安装（写入 ~/.config/opencode/plugins/ 桥接 + 保存 .env）
npm install && npm run build
node dist/cli/install.js        # 或 oprc install

# 代码变更后更新：重新 build，然后重启 opencode（插件随之重载）
npm run build
# 退出并重新启动你的 opencode（hub）实例

# 卸载
node dist/cli/uninstall.js      # 或 oprc uninstall
```

> 插件在 opencode 进程内运行，日志走 opencode 自身的输出。多实例由 PRIMARY 选举
> 决定谁持有 web/bot 单例(锁文件 `~/.opencode/oprc-primary.lock`)。

---

## Standalone host 模式（v0.7.0+，多 agent / 多后端）

`oprc host`（= `node dist/cli/index.js host`）是与 plugin 模式并存的另一种部署：
独立进程，不作为 opencode 插件，可同时挂多个后端（opencode + 任意 ACP agent）并在
界面里切换。这是生产域名 `ocrc.agentjoey.ai` 当前背后的实例。

```bash
# 配置（一次）：复制 .env.acp.example → .env.acp，填 WEB_TOKEN 等
cp .env.acp.example .env.acp

# 启动（必须在有完整 PATH 的真实终端里跑——host 要 spawn opencode/kimi 子进程）
scripts/run-acp-host.sh
# 或直接：
OCRC_BACKENDS="opencode, kimi=kimi acp" WEB_ENABLED=true WEB_PORT=17085 \
  WEB_AUTH=token node dist/cli/index.js host
```

要点：
- **后端来自 `OCRC_BACKENDS`**：`opencode`（host 自 spawn 一个 opencode server，
  默认 4096）/ `<id>=<acp 命令>`（如 `kimi=kimi acp`）。空则退回 `OCRC_ACP_CMD` 单 ACP。
- **前置条件是「登录过」，不是「先启动」**：ACP agent 需 `kimi login` 等做过一次；
  opencode 需装好、配好模型。host 会自己 spawn 这些进程。
- **端口冲突**：host spawn 的 opencode 用 4096，会与 plugin 模式的 `opencode serve
  --port 4096` 撞——两者别同时跑 opencode。
- **web token**：不设 `WEB_TOKEN` 则复用 plugin 模式持久化的 `~/.opencode/oprc-token`，
  已配对设备无需重配。
- **后台常驻**：`nohup node dist/cli/index.js host >log 2>&1 & disown`（前台进程随
  终端关闭被 SIGHUP 杀）。崩溃不自启——建议做 launchd 服务。
- **代码更新**：`npm run build:all`；前端是静态服务（改前端无需重启 host），后端改动
  才需重启 host。
- **ACP 会话持久化**：会话列表 + 历史存 `<state 目录>/acp-sessions.json`，重启不丢。

### 把域名指向 host（cloudflared）
```yaml
# ~/.cloudflared/<tunnel>.yml ingress 里：
  - hostname: ocrc.agentjoey.ai
    service: http://localhost:17085   # host 的 WEB_PORT
```
改后 `kill -HUP <cloudflared-pid>` 热重载（不断隧道，不影响其它 service）。
回滚：改回 plugin 模式端口（17081）+ 再 SIGHUP。配置改动前先备份 yml。

### launchd 自启服务（生产推荐）

host 是前台进程，崩溃不自启、关终端被 SIGHUP 杀。生产用 launchd 常驻：
`~/Library/LaunchAgents/com.ocrc.host.plist`（`RunAtLoad` + `KeepAlive`，崩溃
~10s 自动重启；web-only，env 全在 plist 的 `EnvironmentVariables` 里，web token
复用 `~/.opencode/oprc-token`）。日志 `~/.opencode/ocrc-host.{log,err}`。

```bash
# 首次加载（plist 已就位）
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ocrc.host.plist

# 代码更新后重启：先 build，再 kickstart
npm run build:all && launchctl kickstart -k gui/$(id -u)/com.ocrc.host

# 停（开机也不再起） / 启
launchctl bootout   gui/$(id -u)/com.ocrc.host
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ocrc.host.plist

# 状态 / 日志
launchctl list | grep ocrc            # pid + 上次退出码
tail -f ~/.opencode/ocrc-host.log
```

> 改前端无需 kickstart（静态服务，build 后即生效）；改后端才需重启 host。
> ⚠️ host 自启会 spawn 自己的 opencode（端口 4096）——别再手动 `opencode serve
> --port 4096` 跑 plugin hub，否则撞端口（两者择一）。

### 现在 OCRC 相关的 launchd 服务

| 服务 | 作用 |
|---|---|
| `com.ocrc.host` | 多后端 host（opencode + kimi），serve web :17085 |
| `com.home.cloudflared` | cloudflared 隧道：`ocrc.agentjoey.ai` → `localhost:17085` |

两者一起 = 域名可访问；都开机自启，重启电脑后自动恢复。
（opencode 插件 hub 的 `opencode serve` + TUI 仍是手动管理，跑 Telegram bot。）

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
| `OPENCODE_BASE_URL` | — | opencode serve 地址；plugin 模式下不使用(直接用 SDK client),仅 legacy/sidecar 需要 |
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
