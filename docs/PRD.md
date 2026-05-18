# OpenCode Remote Control — Product Requirements Document (PRD)

> 项目代号：P023
> 版本：v0.5.5
> 覆盖范围：Phase 1 ~ Phase 5 全部功能
> 日期：2026-05-17

---

## 1. 产品概述

**opencode-remote-control** 是一个 sidecar bot，让用户从 Telegram 和浏览器远程控制本地运行的 [opencode](https://opencode.ai) AI 编程助手。用户通过手机或 Web 发送消息，bot 代理提交到 opencode，实时流式返回结果。

### 1.1 核心理念

- **SDK-native** — 不使用 TUI 注入，直接通过 `@opencode-ai/sdk` 的 `session.prompt()` 提交
- **多通道** — 同一套 session 状态，Telegram + Web 双向同步
- **本地化** — 运行在用户机器上，数据不离开本地，`data/state.json` 持久化
- **单用户** — 每安装一份绑定一名用户

---

## 2. 功能清单（按 Phase）

### Phase 1 — Telegram Bot 基础（v0.1.0，14 个 Task）

**消息回路**

| 功能 | 描述 |
|------|------|
| 文本转发 | Telegram bot 接收用户消息 → 提交给 opencode → 流式返回结果 |
| SSE EventStream | 持久化 SSE 连接，自动重连（指数退避 3s base，上限 30s，最多 15 次失败） |
| 节流编辑 | `editMessageText` 的节流控制（默认 1000ms），避免 Telegram 429 |
| TUI 桥接 | `tuiBridge.submit()` 模式提交（Phase 1 默认方式），bot 结束后 TUI 显示对话 |

**命令系统**

| 命令 | 描述 |
|------|------|
| `/start` | 握手 + 健康检查 |
| `/status` | 服务端健康、session 数量、已 pin session |
| `/sessions` | 列出全部 session，带 pin 按钮 |
| `/help` | 命令列表 |
| `/abort` | 停止当前生成 |

**审批**

| 功能 | 描述 |
|------|------|
| 双向审批 | opencode 请求权限时 bot 发送按钮（Allow once / Always / Reject），TUI 端同步更新 |

**部署**

| 功能 | 描述 |
|------|------|
| launchd plist | macOS 后台服务，`~/Library/LaunchAgents/` |

---

### Phase 2 — 富控制面板（v0.2.0）

| 命令 | 描述 |
|------|------|
| `/files` | 列出最近 session 的文件操作（📝 write / ✏️ edit / 📖 read），含 emoji 状态图例 |
| `/agent` | 列出可用 agent，inline 按钮切换（sticky 持久化） |
| `/model` | 列出可用模型，按 provider 分组，inline 按钮切换 |
| `/session <id>` | Pin 指定 session |

**流式改进**

| 功能 | 描述 |
|------|------|
| 实时 streaming | 监听 `message.part.delta` SSE 事件，逐字符推送，替代等待完成后一次性展示 |

**卡片化**

| 功能 | 描述 |
|------|------|
| HTML 卡片 | 所有命令输出统一使用结构化 HTML parse_mode + inline keyboard markup |

---

### Phase 3 — SDK 原生 + 传输层抽象（v0.3.0）

**架构重构**

| 功能 | 描述 |
|------|------|
| SDK 直连提交 | `client.session.prompt()` 替代 TUI inject，支持 per-message agent/model 覆写 |
| Transport 接口 | `Transport` 抽象（start/stop/send/onMessage/onCommand/onButtonClick），Telegram 为首个实现 |
| 核心 relay | `core/relay.ts` — 不依赖任何传输通道，组装 SSE 事件 → CardBus 发布 |
| SessionState | 文件持久化状态（lastSessionId、nextAgent、nextModel），原子写入 |
| AgentContext | 消费型 agent/model 覆写（/agent 设置后仅下一次消息生效） |

**文件树调整**

```
src/
  core/           ← 通道无关核心逻辑
  opencode/       ← opencode SDK 交互层
  transport/      ← 传输通道实现
    interface.ts
    telegram/
  utils/
  config.ts
  index.ts
```

**TUI 可见性**

| 模式 | 描述 |
|------|------|
| `TUI_VISIBLE=true` | relay 同步调用 `appendPrompt` + `selectTuiSession`，TUI 实时看到对话 |
| `TUI_VISIBLE=false` | 完全脱离 TUI，bot 直连 SDK（默认） |

**开源准备**

| 功能 | 描述 |
|------|------|
| 许可证 | MIT |
| CI | GitHub Actions，检查 tsc --noEmit + vitest run |

---

### Phase 4 — 产品化（v0.4.0）

**启动体验**

| 功能 | 描述 |
|------|------|
| 单命令启动 | `npm start` 自动 spawn opencode serve，带重启退避 |
| 进程守护 | supervisor 监听子进程退出，指数退避重试 |
| launchd 一键安装 | 安装/卸载/状态检查脚本 |

**信息对称（TUI 与 Bot）**

| 命令 | 描述 |
|------|------|
| `/diff` | 列出文件变更（pass-through opencode `/session/:id/diff`） |
| `/todo` | 待办事项列表 |
| `/context` | 当前 session 上下文（agent/model/tokens/cost） |

**流式增强**

| 功能 | 描述 |
|------|------|
| 内联工具渲染 | relay 在 assistant 文本下方展示工具调用列表（▸ bash · cmd ✓/✗/…） |
| Stop 内联按钮 | 每次编辑消息附带 ⏹ Stop 按钮，回调触发 abort |
| Cost footer | 每条回复末尾展示 💰 $0.024 ↑1.2k ↓3.4k · agent · model |

**推送通知**

| 功能 | 描述 |
|------|------|
| 长任务完成通知 | >60s 任务结束后 Telegram 主动推送 ✅ Session finished |
| 测试失败通知 | bash 输出含 FAIL 关键词时预警 |
| 速率限制 | 每小时最多 10 条，同一 session 5 分钟冷却 |

**多用户**

| 功能 | 描述 |
|------|------|
| `ALLOWED_USER_IDS` | 逗号分隔，支持多个 Telegram 用户同时控制 |

---

### Phase 5 — Web UI + 架构终态（v0.5.0 ~ v0.5.5）

**a) CardBus 架构（核心重构）**

| 功能 | 描述 |
|------|------|
| StructuredCard | 8 种 variant（thinking / streaming / assistant / user / error / status / info / approval），跨传输统一格式 |
| CardBus | 发布-订阅机制 + ring buffer（默认 100 条/session），订阅者异常隔离 |
| Relay 解耦 | Relay 只对接 CardBus.publish，不直接调用 transport.send/edit |
| 历史重建 | `reconstructHistory(client, sessionId)` — 供 Web 加载历史会话 |

**b) Telegram 流式溢出修复**

| 功能 | 描述 |
|------|------|
| 自适应节流 | 首帧即时 → 前 5 帧 250ms → 之后 1000ms |
| 渐进工具折叠 | ≤7 全显示 / 8-15 前 2+后 5 / >15 前 1+后 4；running 态固定在末尾 |
| 多消息分页 | 超 HARD_LIMIT(3900) 强制切 Part 2；超 SOFT_LIMIT(3500) 在段落/kbd/工具完成边界切 |
| chunkStartOffset | 防分页爆炸——每次切分记录偏移，后续 delta 只从偏移之后开始渲染 |
| 审批修复 | 按钮改用 SDK `permissionRespond`，修复 opencode 无 `/permission/:id/reply` 路由的 HTTP 400 |

**c) Web 后端**

| 功能 | 描述 |
|------|------|
| Hono HTTP server | `/api/*` REST 路由（me / sessions / session:id / message / abort / diff / todo / context / approval / version） |
| WebSocket | raw ws upgrade，`WsHub` 管理 per-client session 订阅 + broadcast |
| CF Access JWT | header / query / cookie 三通道提取，jose 验证 JWKS，dev bypass 仅 loopback |
| SPA fallback | 文件系统优先匹配静态资源，不存在的路径 fallback 到 index.html |
| 多 transport 启动 | `TELEGRAM_BOT_TOKEN` + `WEB_ENABLED=true` 同时运行，共享 CardBus |
| hello 注入 | WS 连接时自动注入 session 列表 |

**d) Web 前端（SvelteKit PWA）**

| 功能 | 描述 |
|------|------|
| 三栏布局 | sidebar (SessionList) + main (卡片流 + Composer) |
| 实时卡片流 | WebSocket → appendCard → store 驱动重渲染 |
| 7 种卡片组件 | Thinking / Streaming / Assistant / Error / Info / Status / User |
| Markdown 渲染 | marked@14 + DOMPurify，20k 字符以上回退 raw text |
| 工具折叠 | ToolCallList 组件，expand/collapse，按状态彩色标记 |
| 自动滚动 | 新卡片到达自动 @bottom，依赖 cards.length 避免多余重排 |
| WS 重连 | 指数退避 (2/4/8/16/30s) + ping/pong (25s/45s) + onReconnect 重订阅 |
| 审批弹窗 | ApprovalModal 叠加层，三按钮，modal 不可关闭除非做出决定 |
| 暗色主题 | CSS variables 全局暗色，无亮色切换 |
| PWA | manifest.webmanifest + service worker + 192/512 图标 |
| Session 列表 | cookie 持久化 active session，点击切换 |
| 响应式 | 移动端 sidebar 缩为 drawer（设计留 TODO） |

**e) Chrome Extension（MV3）**

| 功能 | 描述 |
|------|------|
| 侧边栏 | 复用 PWA 组件，独立 App.svelte 入口 |
| 右键菜单 | 选中文字 / 链接 → "Send to opencode" → 预填 Composer |
| Popup 配置 | 设置 bot URL，存 chrome.storage.local |
| 版本自动同步 | vite plugin 构建时从 root package.json 读取版本号注入 manifest |
| CSP | `script-src 'self'; connect-src https://*` |

**f) 代码质量（v0.5.5 Sprint）**

| WI | 修复 |
|----|------|
| WI-00 | Svelte 5 reactive loop hang → afterNavigate + $page.params 替代 activeSession store 订阅 |
| WI-01 | Card.svelte 补全 7 种 kind 分发 |
| WI-02 | WS onReconnect 自动重新 subscribe |
| WI-03 | Extension App.svelte WS 消息补全 |
| WI-04 | info 类型同步 sessionId? |
| WI-05 | Extension CSP + 版本号同步 |
| WI-06 | 滚动依赖改为 cards.length |
| WI-07 | relay tools 按 part.id 去重 |
| WI-08 | $shared alias 复用后端类型定义 |
| WI-09 | WsHub attach 注入 session 列表 |
| WI-10 | SPA fallback existsSync 替代启发式判断 |
| WI-11 | streaming 去重仅内容变化时替换 |
| WI-12 | card-bus safe() 日志附 kind + sessionId |

---

## 3. 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│  opencode serve (localhost:4096)                             │
│  HTTP + SSE + TUI                                            │
└──────────────────────┬───────────────────────────────────────┘
                       │ SDK + SSE
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  opencode-remote-control (bot process)                       │
│                                                              │
│  ┌──────────────┐  ┌──────────────────────────────────────┐ │
│  │ EventStream   │──▶ relay.ts                             │ │
│  │ (1 SSE conn)  │  │ publish StructuredCard → CardBus     │ │
│  └──────────────┘  └──────────┬───────────────────────┬───┘ │
│                               │                       │     │
│                               ▼                       ▼     │
│                     ┌─────────────────┐  ┌─────────────────┐ │
│                     │ Telegram         │  │ Web (Hono+WS)    │ │
│                     │ SessionRenderer  │  │ WsHub broadcast  │ │
│                     └────────┬────────┘  └────────┬────────┘ │
│                              │                    │          │
│  ┌────────────┐              │                    │          │
│  │ push.ts     │← onAny       │                    │          │
│  │ notification│              │                    │          │
│  └────────────┘              │                    │          │
└──────────────────────────────┼────────────────────┼──────────┘
                               ▼                    ▼
                         Telegram API     Cloudflare Tunnel
                         (polling)        → PWA / Extension
```

### 3.1 关键数据流

1. **用户消息**: Telegram/Web → `relay.ts` → `client.session.prompt()` → opencode
2. **实时输出**: opencode SSE → `relay.ts` → `CardBus.publish(StructuredCard)` → Telegram renderer + WsHub 独立渲染
3. **推送通知**: `push.ts` 监听 `EventStream.onAny` → `session.idle` → `fetchSummary()` → CardBus → Telegram sendMessage
4. **历史回放**: Web `GET /api/session/:id` → `reconstructHistory()` → StructuredCard[]

---

## 4. 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Node.js 20, TypeScript |
| SDK | `@opencode-ai/sdk` |
| Telegram | `telegraf` (polling) |
| Web 后端 | `hono@^4` + `ws@^8` + `jose@^6` |
| Web 前端 | SvelteKit 2.60 + Svelte 5.55 + adapter-static |
| Markdown | `marked@^14` + `DOMPurify@^3` |
| Extension | Chrome MV3, Vite 5 |
| 配置 | Zod |
| 测试 | Vitest, @testing-library/svelte, Playwright (E2E 预留) |
| 部署 | launchd (macOS), Cloudflare Tunnel + Access |

---

## 5. 配置

```bash
# Telegram
TELEGRAM_BOT_TOKEN=         # @BotFather
ALLOWED_USER_ID=            # @userinfobot
OPENCODE_BASE_URL=http://localhost:4096
TUI_VISIBLE=false           # 实时同步到 TUI
CHAT_TIMEOUT_MS=600000      # 10 min

# Web
WEB_ENABLED=false
WEB_HOST=127.0.0.1
WEB_PORT=7081
WEB_STATIC_ROOT=web/dist
WEB_CF_ACCESS_TEAM=
WEB_CF_ACCESS_AUD=
WEB_CF_ACCESS_DEV_BYPASS=false
WEB_CF_ACCESS_DEV_EMAIL=dev@localhost

# Telegram 分页
TG_CHUNK_SOFT_LIMIT=3500
TG_CHUNK_HARD_LIMIT=3900
```

---

## 6. 测试覆盖

| 指标 | 数值 |
|------|------|
| Root unit tests | 26 文件 / 140 用例 |
| Web unit tests | 2 文件 / 4 用例 |
| E2E (Playwright) | 预留，待手动验证 |
| TypeScript | tsc --noEmit clean |

---

## 7. 版本历史

| 版本 | 阶段 | 关键交付 |
|------|------|---------|
| v0.1.0 | Phase 1 | Telegram bot 基础（消息/命令/审批/streaming） |
| v0.2.0 | Phase 2 | 富控制面板（files/agent/model 命令）+ 实时流式 + 卡片化 |
| v0.3.0 | Phase 3 | SDK 直连 + Transport 抽象 + SessionState + OSS prep |
| v0.4.0 | Phase 4 | 产品化（单命令启动/launchd/信息对称/push 通知/Stop inline/cost footer） |
| v0.5.0~v0.5.2 | Phase 5.A-C | Web UI + CardBus + Telegram 流式分页 |
| v0.5.3 | Phase 5.D | Push 中文摘要 + timeout 不当错误 |
| v0.5.4 | Phase 5.E | 审批修复 + push busySince fallback |
| v0.5.5 | Sprint | WI-00~WI-12 code review 修复 |
