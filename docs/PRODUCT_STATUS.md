# Product Status — opencode-remote-control

> 版本: v0.5.7 | 更新: 2026-06-08

## 基本信息

| 项目 | 详情 |
|---|---|
| **版本** | v0.5.7 |
| **定位** | SDK-native 的 opencode 远程控制 sidecar bot |
| **支持通道** | Telegram + Web (PWA + Chrome Extension) |
| **运行时** | Node.js 20+, TypeScript |
| **测试覆盖** | 26 测试文件 / 144 用例全部通过 |
| **许可证** | MIT |

---

## Phase 1 — Telegram Bot 基础 (v0.1.0)

| 功能 | 状态 |
|---|---|
| 文本转发 (Telegram → opencode → 流式返回) | ✅ |
| SSE EventStream 持久化连接 + 指数退避重连 | ✅ |
| 节流编辑控制 | ✅ |
| TUI 桥接 | ✅ |
| 命令: `/start` `/status` `/sessions` `/session` `/help` `/abort` | ✅ |
| 双向审批 (Allow once / Always / Reject) | ✅ |
| launchd macOS 后台服务 | ✅ |

---

## Phase 2 — 富控制面板 (v0.2.0)

| 功能 | 状态 |
|---|---|
| `/files` 列出文件操作 | ✅ |
| `/agent` 切换 agent (sticky 持久化) | ✅ |
| `/model` 两步选模型 (provider → model) | ✅ |
| Card 化命令输出 (HTML parse_mode + inline keyboard) | ✅ |
| 实时 streaming 监听 `message.part.delta` | ✅ (Telegram 已改为最终结果) |

---

## Phase 3 — SDK 原生 + 传输层抽象 (v0.3.0)

| 功能 | 状态 |
|---|---|
| SDK 直连提交 `client.session.prompt()` | ✅ |
| Transport 接口抽象 (edit / buttons / richText / streaming) | ✅ |
| 核心 relay 独立于传输层 | ✅ |
| SessionState 文件持久化 (原子写入) | ✅ |
| AgentContext 消费型 agent/model 覆写 | ✅ |
| TUI_VISIBLE 可选同步 | ✅ |
| GitHub Actions CI | ✅ |

---

## Phase 4 — 产品化 (v0.4.0)

| 功能 | 状态 |
|---|---|
| 单命令启动 `oprc` / `npm start` | ✅ |
| SPAWN_OPENCODE 自动启动 opencode serve | ✅ |
| 进程守护 (指数退避 2s→4s→8s→16s→30s) | ✅ |
| `/diff` 文件变更 | ✅ |
| `/todo` 待办列表 | ✅ |
| `/context` session 上下文 (agent/model/tokens/cost) | ✅ |
| 内联工具渲染 (▸ bash · cmd / ▸ read · path) | ✅ (Telegram 最终结果) |
| Cost footer (💰 $X.XX · ↑in ↓out · agent · model) | ✅ |
| 推送通知: 长任务完成 + 测试失败预警 | ✅ |
| 速率限制 (10条/小时, 5min/session 冷却) | ✅ |
| ALLOWED_USER_IDS 多用户白名单 | ✅ |

---

## Phase 5 — Web UI + CardBus 架构 (v0.5.0 ~ v0.5.7)

### a) CardBus 核心重构

| 功能 | 状态 |
|---|---|
| StructuredCard 8 种 variant | ✅ |
| CardBus 发布-订阅 + ring buffer (100条/session) | ✅ |
| Relay 解耦 (只对接 CardBus) | ✅ |
| 历史重建 `reconstructHistory()` | ✅ |

### b) Telegram 流式溢出修复

| 功能 | 状态 |
|---|---|
| 渐进工具折叠 (≤7/8-15/>15) | ✅ |
| 多消息分页 (SOFT_LIMIT 3500 / HARD_LIMIT 3900) | ✅ |
| 审批修复 (SDK `permissionRespond`) | ✅ |
| TCP hang 10s 超时防护 | ✅ |
| Delta 增量累积 + 空文本防覆盖 | ✅ |
| 429 retry_after 上限 5s | ✅ |
| v0.5.7: Telegram 去流式化 (仅返回最终结果) | ✅ |

### c) Web 后端 (Hono + WS)

| 功能 | 状态 |
|---|---|
| REST API (`/api/me` `/api/sessions` `/api/session/:id` `/api/message` `/api/abort` `/api/diff` `/api/todo` `/api/context` `/api/approval` `/api/version`) | ✅ |
| WebSocket: WsHub per-client subscription + broadcast | ✅ |
| Cloudflare Access JWT 验证 (header/query/cookie) | ✅ |
| SPA fallback | ✅ |
| 多 transport 同时运行 (Telegram + Web 共享 CardBus) | ✅ |

### d) Web 前端 (SvelteKit PWA)

| 功能 | 状态 |
|---|---|
| 三栏布局 (SessionList + CardStream + Composer) | ✅ |
| 7 种卡片组件 | ✅ |
| WebSocket 实时卡片流 + 自动重连 | ✅ |
| Markdown 渲染 (marked + DOMPurify) | ✅ |
| 工具折叠组件 | ✅ |
| 审批弹窗 | ✅ |
| 暗色主题 | ✅ |
| PWA (manifest + service worker + 图标) | ✅ |
| Session 列表切换 | ✅ |
| 响应式 (移动端 sidebar drawer：设计稿 TODO) | 🟡 |

### e) Chrome Extension (MV3)

| 功能 | 状态 |
|---|---|
| 侧边栏 (复用 PWA 组件) | ✅ |
| 右键菜单 "Send to opencode" | ✅ |
| Popup 配置 bot URL | ✅ |
| 版本号自动同步 + CSP | ✅ |

### f) 代码质量 (v0.5.5 Sprint)

| WI | 内容 | 状态 |
|---|---|---|
| WI-00 ~ WI-12 | Svelte 5 reactive fix, Card dispatch, WS reconnect, relay tools dedup, etc. | ✅ |

---

## 当前架构

```
opencode serve (:4096)
        │
        ▼ SDK + SSE
opencode-remote-control
  ├── EventStream (1 SSE conn)
  │     └── relay.ts → CardBus.publish(StructuredCard)
  ├── CardBus ──┬── Telegram SessionRenderer (sendMessage only)
  │             └── WsHub broadcast → WebSocket → PWA / Extension
  ├── push.ts (onAny → session.idle → 推送通知)
  └── Transport 接口 (Telegram + Web)
```

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js 20, TypeScript |
| SDK | `@opencode-ai/sdk` |
| Telegram | `telegraf` |
| Web 后端 | `hono@^4` + `ws@^8` + `jose@^6` |
| Web 前端 | SvelteKit 2.60 + Svelte 5.55 |
| Markdown | `marked@^14` + `DOMPurify@^3` |
| Extension | Chrome MV3, Vite 5 |
| 配置 | Zod |
| 测试 | Vitest, 144 用例 |
| 部署 | launchd (macOS), Cloudflare Tunnel + Access |
