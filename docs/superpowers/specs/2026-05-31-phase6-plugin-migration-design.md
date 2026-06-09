# Phase 6 Design Spec — Plugin Registry Migration

> 日期：2026-05-31
> 目标版本：v0.6.0-rc.1
> 前置研究：`design/plugin-registry-migration.md`（Obsidian）、doza62/opencode-mobile 源码分析

## Goal

将 opencode-remote-control 从独立 sidecar 进程转变为 **openCode Plugin Registry 模式**。用户只需 `npx opencode-remote-control install` 安装一次，之后每次启动 `opencode` 插件自动运行 Telegram bot + Web UI，无需额外终端、无需 launchd、无需 `npm start`。

### 对比

```
◀──── 当前 v0.5.7 ────▶                  ◀──── 目标 v0.6.0 ────▶
Terminal 1: opencode serve               Terminal 1: opencode
Terminal 2: oprc start                    → Plugin 自动启动
或: launchd plist                          → Telegram bot ✅
                                           → Web PWA ✅
```

## 前提：Plugin API 能力确认

| 需求 | Plugin API 支持 | 说明 |
|------|:---:|------|
| `ctx.client` — 完整 SDK client | ✅ | 等同 `createOpencodeClient()`，可直接 `client.session.prompt()` |
| `event` hook — 事件订阅 | ✅ | `session.*` / `message.*` / `permission.*` / `command.*` 全覆盖 |
| 启动长期运行服务（Telegraf、Hono） | ✅ | 异步启动，不阻塞 init（opencode-mobile 已验证） |
| 文件读写 | ✅ | `fs` API 可用，state.json 持久化不受影响 |
| HTTP Server 绑定端口 | ✅ | `http.createServer` 或 Bun.serve |
| 环境变量读取 | ✅ | `process.env.*` 继承 opencode 进程 env |
| `tool()` — 自定义命令 | ✅ | 可暴露 `/rc-status` 等管理命令 |

## Section 1 — 文件树变更

```
新建:
  src/plugin/
    entry.ts                  ← Plugin 入口，导出 Plugin 函数
    config.ts                 ← 从 opencode.json env + process.env 读取配置

保留（不变）:
  src/core/   — relay, card-bus, state, push, history, stream-accumulator, etc.
  src/transport/ — interface, telegram/*, web/*
  src/opencode/ — client, event-stream, submit
  src/utils/   — logger, markdown
  web/         — SvelteKit PWA 前端

变更:
  src/index.ts                ← 保留旧入口，增加 RC_MODE=legacy 兼容
  src/opencode/client.ts      ← Plugin 模式不从 ctx 外调用 createOpencodeClient
  src/config.ts               ← 新增 loadPluginConfig()，兼容 opencode.json
  package.json                ← 增加 @opencode-ai/plugin 依赖 + "exports" 字段

新增 CLI:
  src/cli/install.ts          ← npx opencode-remote-control install 安装到 opencode.json
  src/cli/uninstall.ts        ← npx opencode-remote-control uninstall

废弃（保留兼容，Phase C 移除）:
  src/launcher/*              ← opencode 自身即 launcher，不再需要
  scripts/install-launchd.sh  ← Plugin 不需要 launchd

移除:
  dotenv                       ← 改用 opencode 进程环境变量
  health check 循环            ← Plugin 在 opencode 进程内，天然健康
```

## Section 2 — Plugin 入口设计

```typescript
// src/plugin/entry.ts

import { tool } from '@opencode-ai/plugin'
import type { Plugin } from '@opencode-ai/plugin'
import { loadPluginConfig } from './config.js'
import { createTelegramTransport } from '../transport/telegram/index.js'
import { createWebTransport } from '../transport/web/index.js'
import { createFileBackedState } from '../core/state.js'
import { createRelay } from '../core/relay.js'
import { createCardBus } from '../core/card-bus.js'
import { startPushNotifications } from '../core/push.js'
import { createLogger } from '../utils/logger.js'

export const remoteControlPlugin: Plugin = async (ctx) => {
  const log = createLogger('plugin')
  const config = loadPluginConfig(ctx)
  const version = '0.6.0'

  log.info(`starting, transport=${config.transport}, web=${config.webEnabled}`)

  // ctx.client 已是完整 SDK client，无需 createOpencodeClient()
  const state = createFileBackedState(config.statePath)
  const cardBus = createCardBus()

  // 事件流订阅 — 使用 opencode 内部 event hook
  // 注意：Plugin 没有独立的 SSE EventStream，
  // relay 需要适配为直接消费 opencode session events
  const relay = createRelay({
    cardBus,
    client: ctx.client,
    state,
    chatTimeoutMs: config.chatTimeoutMs,
    tuiVisible: config.tuiVisible,
    baseUrl: '',  // Plugin 模式下不需要 baseUrl
  })

  // 启动 Transport
  const tgTransport = createTelegramTransport({
    token: config.telegramBotToken,
    allowedUserIds: config.allowedUserIds,
    client: ctx.client,
    state,
  })
  tgTransport.onMessage(relay)

  const transports = [tgTransport]

  if (config.webEnabled) {
    const webT = createWebTransport({
      host: config.webHost,
      port: config.webPort,
      client: ctx.client,
      cfAccess: {
        team: config.webCfAccessTeam,
        aud: config.webCfAccessAud,
        devBypass: config.webCfAccessDevBypass,
        devEmail: config.webCfAccessDevEmail,
      },
      staticRoot: config.webStaticRoot,
      cacheSize: config.webCacheSize,
    })
    transports.push(webT)
  }

  await Promise.all(transports.map((t) => t.start({ cardBus, state })))
  log.info('all transports started')

  return {
    // 事件 hook — 所有 opencode 事件通过此回调进入 relay
    event: async ({ event }) => {
      // 事件类型分发
      switch (event.type) {
        case 'session.idle':
        case 'session.error':
        case 'session.created':
        case 'session.deleted':
        case 'session.updated':
        case 'session.status':
        case 'message.part.updated':
        case 'message.updated':
        case 'message.part.removed':
        case 'message.removed':
        case 'permission.asked':
        case 'permission.replied':
        case 'command.executed':
          await relay.handleEvent(event)
          break
      }
    },

    // 管理工具 — 可选的 /rc-status 命令
    tool: {
      'rc-status': tool({
        description: 'Show remote-control plugin status',
        args: {},
        async execute() {
          return [
            `Remote Control v${version}`,
            `Telegram: ${tgTransport.isRunning ? '✅' : '❌'}`,
            `Web:     ${config.webEnabled ? '✅ :7081' : '—'}`,
          ].join('\n')
        },
      }),
    },
  }
}

export default remoteControlPlugin
```

## Section 3 — 配置迁移

```
◀──── 旧 (.env) ────▶                ◀──── 新 (opencode.json env) ────▶
TELEGRAM_BOT_TOKEN=xxx               ~/.config/opencode/opencode.json
ALLOWED_USER_IDS=123,456             { "plugin": ["opencode-remote-control@latest"],
WEB_ENABLED=true                       "env": {
WEB_PORT=7081                            "TELEGRAM_BOT_TOKEN": "xxx",
                                         "ALLOWED_USER_IDS": "123,456",
                                         "WEB_ENABLED": "true"
                                       }
                                     }
```

```typescript
// src/plugin/config.ts

export function loadPluginConfig(ctx: PluginContext): PluginConfig {
  return {
    telegramBotToken:   required(process.env.TELEGRAM_BOT_TOKEN),
    allowedUserIds:     parseUserIds(process.env.ALLOWED_USER_IDS ?? ''),
    webEnabled:         process.env.WEB_ENABLED === 'true',
    webHost:            process.env.WEB_HOST ?? '127.0.0.1',
    webPort:            Number(process.env.WEB_PORT ?? 7081),
    webStaticRoot:      process.env.WEB_STATIC_ROOT ?? 'web/dist',
    webCacheSize:       Number(process.env.WEB_SESSION_CACHE_SIZE ?? 100),
    webCfAccessTeam:    process.env.WEB_CF_ACCESS_TEAM ?? '',
    webCfAccessAud:     process.env.WEB_CF_ACCESS_AUD ?? '',
    webCfAccessDevBypass: process.env.WEB_CF_ACCESS_DEV_BYPASS === 'true',
    webCfAccessDevEmail: process.env.WEB_CF_ACCESS_DEV_EMAIL ?? 'dev@localhost',
    tuiVisible:         process.env.TUI_VISIBLE === 'true',
    statePath:          process.env.STATE_PATH ?? './data/state.json',
    transport:          process.env.TRANSPORT ?? 'telegram',
    chatTimeoutMs:      Number(process.env.CHAT_TIMEOUT_MS ?? 600000),
  }
}
```

## Section 4 — Relay 适配变化

当前 relay 依赖 `EventStream`（SSE 订阅 `@opencode-ai/sdk`）。Plugin 模式下，openCode 内部已有事件流，我们直接使用 `event` hook。

**变化点：**

| 当前 | Plugin 模式 |
|------|------------|
| `EventStream.onEvent('session.idle', fn)` | `event hook → event.type === 'session.idle'` |
| `EventStream.onEvent('message.part.updated', fn)` | `event hook → event.type === 'message.part.updated'` |
| 独立的 SSE 重连逻辑 | 不需要（Plugin 在进程内） |
| `eventStream.session(id)` 生成器 | 不需要（session 关联由 opencode 内部维护） |

**适配方案：** 在 `relay.ts` 中新增 `handleEvent()` 方法，接收原始 event 对象，内部按 `event.type` 分发到现有的处理逻辑（CardBus publish 等）。同时保留旧的 `EventStream` 路径供 legacy 模式使用。

## Section 5 — CLI 安装流程

```bash
# 安装到全局
npx opencode-remote-control install
  → 1. 读取 ~/.config/opencode/opencode.json
  → 2. 注入 "plugin": ["opencode-remote-control@latest"]
  → 3. 交互输入 TELEGRAM_BOT_TOKEN、ALLOWED_USER_IDS
  → 4. 写入 env 字段
  → 5. 提示 restart opencode

# 安装到项目
npx opencode-remote-control install --local
  → 1. 读取 ./opencode.json
  → 2. 同上流程
```

参考 opencode-mobile 的 `install.ts` 实现（`jsonc-parser` 解析 + `fs.writeFileSync` 写入）。

## Section 6 — 向后兼容

- 旧入口 `src/index.ts` 保留，通过 `RC_MODE=legacy` 显式调用
- launchd plist 不移除但标记 deprecated
- 现有 144 个测试全部保持通过
- `opencode --pure` 全局 flag 可跳过所有插件（含 remote-control）

## Section 7 — 风险 & 缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| Telegraf 在 Bun 下长轮询行为差异 | 低 | Telegraf 使用标准 `http` / `https` 模块，Bun 完全兼容 |
| `client.session.prompt()` 需要 baseUrl，Plugin 模式无 | 低 | `ctx.client` 已内置 baseUrl，无需外部配置 |
| Plugin event 事件类型不完整 | 低 | 已验证 openCode docs 覆盖所有需要的事件类型 |
| Transport.start() 阻塞 init | 中 | 使用 `setImmediate` + 异步启动，init 函数立即返回 |
| opencode.json plugin 安装失败 | 低 | 回退到手动添加文档 + 命令 |
| Hono + WS 端口冲突 | 低 | 自动检测端口，增量后退（7081→7082→…） |

## 竞品参考

- **doza62/opencode-mobile** — Plugin 形态典范，`npx install` → opencode.json → 自动启动 LAN server + tunnel
- **opencode-wakatime** — 事件驱动的 Plugin，监听 session.idle 上报
- **opencode-notificator** — 桌面通知 Plugin，监听事件

以上三个均证明 Plugin 可承载 HTTP server + 长连接 + 事件驱动逻辑。
