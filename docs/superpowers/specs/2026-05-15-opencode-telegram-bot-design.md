# opencode-telegram-bot — 设计文档

| Field | Value |
|-------|-------|
| Version | v0.1 (spec) |
| Date | 2026-05-15 |
| Status | Approved for implementation |
| Replaces | `telegram-opencode-bot/` (abandoned) |
| Location | `/Users/REDACTED/AgentWorks/Code_Opencode/opencode-telegram-bot/` |

---

## 1. 项目目标与背景

通过 Telegram Bot 远程控制本地 opencode 实例，实现外出/移动时继续与桌面 TUI 进行的开发对话。语义与 Claude Code CLI 的 Telegram 集成对齐：Bot 是一条 IO 通道，AI agent 自身（opencode）独立运行。

### 上一代失败教训

`telegram-opencode-bot/` 失败原因（按影响排序）：

1. **双入口点混乱** — `index.ts`（legacy）与 `cli.ts`（新 `--telegram`）并存，bot.log 显示线上跑的是 legacy 入口
2. **事件订阅竞态** — `opencode-stream.ts` 在 `promptAsync` 之后清空队列，事件可能在订阅完成与清空之间到达被丢弃
3. **`botMessageId` 过滤的 bootstrap 问题** — 若首个捕获的 messageID 来自 TUI，后续 bot 事件全被错误过滤
4. **Embedded 进程模型复杂度爆炸** — PID lock + watchdog + ppid 检测 + spawn 子进程 + 孤儿清理，组合错位率高
5. **MarkdownV2 在 approval 转义不全** — AI 生成的 title 含特殊字符即 400
6. **零测试** — 任何 schema/事件流变化都靠手测发现

新项目针对每一条都有对应对策（见 §6）。

---

## 2. 架构总览

### 进程拓扑

```
┌───────────────┐    ┌──────────────────┐    ┌───────────────────────────┐
│   iPhone      │───▶│   Telegram       │───▶│  opencode-telegram-bot    │
│   Telegram    │    │   Bot API        │    │  (Node 20, launchd)       │
└───────────────┘    └──────────────────┘    └─────────────┬─────────────┘
                                                           │ HTTP/SSE
                                                           ▼
                                             ┌───────────────────────────┐
                                             │  opencode server          │
                                             │  http://localhost:4096    │
                                             │  (用户手动/launchd 启动)  │
                                             └─────────────┬─────────────┘
                                                           │
                                                           ▼
                                             ┌───────────────────────────┐
                                             │  TUI 等其它客户端          │
                                             │  (与 Bot 共享同一 session)│
                                             └───────────────────────────┘
```

### 核心约束

| 约束 | 决策 |
|------|------|
| 进程关系 | **Sidecar relay**：Bot 不管 opencode 生命周期 |
| 进程数 | Bot 单进程；与 opencode 解耦 |
| 通信 | Bot → opencode：HTTP REST；opencode → Bot：SSE (`GET /event`) |
| 会话语义 | **TUI 远程控制**：把消息塞进 TUI 当前 session，不自管 session |
| 用户 | **仅本人**（Telegram whitelist 1 个 ID） |
| 进程管理 | launchd，KeepAlive + RunAtLoad |
| 失败哲学 | TUI 未运行 → **立即报错，不降级，不自动 spawn opencode** |

### 与原项目的差异

| 项 | 原 telegram-opencode-bot | 新 opencode-telegram-bot |
|----|--------------------------|--------------------------|
| 进程模型 | Embedded（spawn opencode 子进程） | Sidecar（连已运行的 opencode） |
| 入口点 | 双入口 (index.ts + cli.ts) | 单入口 (src/index.ts) |
| Session 管理 | 每用户 `tg:<userId>` + /join | 无自管 session，直接走 TUI |
| 事件过滤 | 自行 messageID 过滤 | 由 `/session/status` diff 拿到 sessionID |
| 进程监控 | PID lock + watchdog + ppid | launchd 接管 |
| 测试 | 无 | Vitest 单测 + 契约测 + 手测验收 |

---

## 3. 组件与文件布局

### 文件结构

```
opencode-telegram-bot/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── docs/superpowers/specs/
│   └── 2026-05-15-opencode-telegram-bot-design.md
│
├── src/
│   ├── index.ts                 # 唯一入口：load env → 校验 → 启动 bot
│   ├── config.ts                # Zod env schema
│   │
│   ├── opencode/
│   │   ├── client.ts            # createOpencodeClient 封装 + /global/health
│   │   ├── event-stream.ts      # SSE 订阅（单例，自动重连）
│   │   └── tui-bridge.ts        # submit-prompt + session/status 探测
│   │
│   ├── bot/
│   │   ├── index.ts             # createBot + 中间件 + command 注册
│   │   ├── handlers/
│   │   │   ├── chat.ts          # 普通文本消息 → submit → 流式回复
│   │   │   ├── approval.ts      # permission.updated → InlineKeyboard
│   │   │   └── commands.ts      # /start /status /sessions /current /abort /help
│   │   └── reply.ts             # 流式 editMessage + 节流 + 长消息分片
│   │
│   └── utils/
│       ├── logger.ts            # 简单 stdout/stderr 双流
│       └── markdown.ts          # MarkdownV2 转义（仅 approval 卡片用）
│
├── deploy/
│   └── ai.opencode.telegram-bot.plist   # launchd 模板
│
└── tests/
    ├── unit/
    │   ├── tui-bridge.test.ts
    │   ├── event-stream.test.ts
    │   └── reply.test.ts
    └── integration/
        └── live-opencode.test.ts    # 对真实 :4096 跑（手动 / CI 可选）
```

### 模块职责矩阵

| 模块 | 职责 | 不做的事 |
|------|------|----------|
| `opencode/client.ts` | SDK client 单例 + `/global/health` | 不持有业务状态 |
| `opencode/event-stream.ts` | 单条 SSE、3s 重连、按 sessionID 分发 | 不解析业务（part 文本等） |
| `opencode/tui-bridge.ts` | `submit(text) → sessionId` | 不管事件 |
| `bot/handlers/chat.ts` | 收消息 → submit → 订阅事件 → reply 流式写 | 不直接 SSE |
| `bot/handlers/approval.ts` | 监听 permission.updated → 卡片 → POST reply | 不参与 chat 流 |
| `bot/reply.ts` | editMessageText 节流 (1s) + 长消息分页 | 不解析事件 |

### 依赖

```json
{
  "dependencies": {
    "@opencode-ai/sdk": "^1.14.0",
    "telegraf": "^4.16.3",
    "zod": "^3.23.8",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "tsx": "^4.15.0",
    "vitest": "^1.6.0",
    "@types/node": "^20.14.0"
  }
}
```

Phase 1 故意删掉：`concurrently`（不需要 spawn 子进程）、`eslint`（先省）。

### 配置文件

**`.env.example`**

```env
# Telegram Bot Token from @BotFather
TELEGRAM_BOT_TOKEN=

# Single allowed Telegram user ID
ALLOWED_USER_ID=

# opencode server (默认假设你 TUI 跑在 :4096)
OPENCODE_BASE_URL=http://localhost:4096

# 流式 edit 节流（毫秒）
EDIT_THROTTLE_MS=1000

# 单条对话 timeout（毫秒）
CHAT_TIMEOUT_MS=120000

LOG_LEVEL=info
```

---

## 4. 数据流

### 4.1 用户发消息 → 流式回复

```
┌─ Telegram 用户："帮我重构 src/auth.ts" ─┐
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ bot/handlers/chat.ts                                              │
│                                                                   │
│ 1. statusMsg = await ctx.reply("💭 thinking...")                  │
│ 2. ctx.sendChatAction('typing') 启动 4s 间隔循环                  │
│ 3. const sessionId = await tuiBridge.submit(text)                 │
│ 4. for await (event of eventStream.session(sessionId, ac.signal)) │
│      switch event.type:                                           │
│        - message.part.updated → fullText = part.text              │
│                                  reply.update(statusMsg, fullText)│
│        - session.idle         → break                             │
│        - session.error        → throw new Error(...)              │
│ 5. reply.finalize(statusMsg, fullText)   // 长消息分片            │
│ 6. clearInterval(typingLoop)                                      │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 `tuiBridge.submit()` 实现

```typescript
async submit(text: string): Promise<string> {
  // 1. 提交前快照：当前 busy sessions
  const before = new Set(Object.keys(await getSessionStatus()))

  // 2. 提交
  const res = await fetch(`${base}/tui/submit-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const ok = await res.json()
  if (ok !== true) throw new Error('TUI submit-prompt rejected')

  // 3. 提交后轮询：找"新变 busy"的 sessionID（5s deadline，100ms 间隔）
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const status = await getSessionStatus()
    const busy = Object.entries(status).find(([id, s]) =>
      s.type === 'busy' && !before.has(id)
    )
    if (busy) return busy[0]
    await sleep(100)
  }

  throw new Error('No session went busy within 5s — is TUI running?')
}
```

**边界情况：TUI 已经 mid-response**
若提交时 TUI 正在响应某个 session（该 sessionID 已在 `before` 集合），新提交可能被 opencode 排队到同一 session、或同一 session 继续 busy。无论哪种，"newly busy" 都为空，5s 后 throw `'No session went busy'`。这是**故意的**：拒绝用户在 TUI 还没回完时再发消息，避免事件流交错。用户可 `/abort` 后再发。

### 4.3 `eventStream` 实现

```typescript
class EventStream {
  private emitter = new EventEmitter()
  private stopped = false

  async start(client: OpencodeClient) {
    while (!this.stopped) {
      try {
        const { stream } = await client.event.subscribe()
        for await (const event of stream) {
          if (this.stopped) break
          const sid = this.extractSessionID(event)
          if (sid) this.emitter.emit(sid, event)
          this.emitter.emit('*', event)
        }
      } catch (err) {
        logger.warn('SSE lost, reconnect in 3s', err)
      }
      if (!this.stopped) await sleep(3000)
    }
  }

  // 3 种 payload 形状（来自 types.gen.ts）：
  //   - session.idle / session.error / permission.* : properties.sessionID
  //   - message.part.updated                       : properties.part.sessionID
  //   - message.updated                            : properties.info.sessionID
  private extractSessionID(e: any): string | undefined {
    const p = e.properties
    return p?.sessionID || p?.part?.sessionID || p?.info?.sessionID
  }

  // 异步迭代器，自动在 abort 时清理
  async *session(id: string, signal: AbortSignal) {
    const queue: any[] = []
    let resolve: (() => void) | null = null
    const handler = (e: any) => { queue.push(e); resolve?.(); resolve = null }
    this.emitter.on(id, handler)
    signal.addEventListener('abort', () => this.emitter.off(id, handler))
    try {
      while (!signal.aborted) {
        while (queue.length) yield queue.shift()
        if (signal.aborted) break
        await new Promise<void>(r => { resolve = r })
      }
    } finally {
      this.emitter.off(id, handler)
    }
  }
}
```

### 4.4 Approval 推送（双向）

**chatId 来源**：Bot 不支持 group / 多人，仅给单一 Telegram 用户发 DM。在 DM 场景下 `chat.id === user.id === ALLOWED_USER_ID`。`approval.ts` 直接用 `config.ALLOWED_USER_ID` 作 chatId，无需先等待入站消息。

```
opencode 想跑 bash command
         │
         ▼ permission.updated event 进 SSE
         │
┌────────────────────────────────────────────────────────────────┐
│ bot/handlers/approval.ts (eventStream.onAny)                    │
│                                                                 │
│ 1. event.type === 'permission.updated'                          │
│ 2. const { id, title, sessionID } = event.properties            │
│ 3. text = `🔐 Approval Required\n\n${title}`  (纯文本)          │
│ 4. msg = await bot.telegram.sendMessage(ALLOWED_USER_ID, text, {│
│      reply_markup: { inline_keyboard: [                         │
│        [Allow Once, Always],                                    │
│        [Reject]                                                 │
│      ]}                                                         │
│    })                                                           │
│ 5. pending.set(id, { messageId: msg.message_id, title })        │
└────────────────────────────────────────────────────────────────┘

         ┌─ 用户在 Telegram 点 ✅ Allow Once ─┐
                                              │
                                              ▼
┌────────────────────────────────────────────────────────────────┐
│ bot.action(/^approve:(once|always|reject):(.+)$/)               │
│                                                                 │
│ 1. POST /permission/{id}/reply { response: 'once' }             │
│ 2. editMessage(messageId, `✅ Allowed once\n\n${title}`)        │
│ 3. answerCbQuery('Allowed')                                     │
│ 4. pending.delete(id)                                           │
└────────────────────────────────────────────────────────────────┘

旁路：用户在 TUI 上同意？
         │
         ▼ permission.replied event 进 SSE
         │
┌────────────────────────────────────────────────────────────────┐
│ eventStream.onAny: permission.replied                           │
│                                                                 │
│ 1. const { permissionID, response } = event.properties          │
│ 2. const p = pending.get(permissionID); if (!p) return          │
│ 3. editMessage(p.messageId, `${response} (from TUI)`)           │
│ 4. pending.delete(permissionID)                                 │
└────────────────────────────────────────────────────────────────┘
```

### 4.5 流式编辑节流

- Telegram `editMessageText` 速率上限约 1 msg/s
- `reply.update(msg, text)` 内部记录 `lastEditAt`，距上次 < `EDIT_THROTTLE_MS` 直接丢弃
- 终态用 `reply.finalize(msg, text)` 强写一次（不节流），随后超长再分页

### 4.6 命令清单（Phase 1）

| 命令 | 行为 |
|------|------|
| `/start` | 健康检查 + 欢迎语 |
| `/status` | `/global/health` 结果 + `/session/status` 当前 busy session 数 |
| `/sessions` | `client.session.list()` 列出所有 session（含创建时间、title）|
| `/current` | 显示上一次 chat 用到的 sessionID |
| `/abort` | 对上一次 sessionID 调 `POST /session/{id}/abort` |

**state 归属**：`bot/index.ts` 内一个 `let lastSessionId: string \| undefined`，chat handler 每次 `tuiBridge.submit` 成功后写入，`/current` 与 `/abort` 读取。**不持久化**（进程重启即丢失，符合 MVP 简洁性）。
| `/help` | 命令清单 |

文件浏览（`/files`/`/read`）和 agent 切换（`/agent`）属 Phase 2，不在 MVP。

---

## 5. 错误处理

### 5.1 失败矩阵

| 失败场景 | 处理 |
|----------|------|
| 启动时 `/global/health` 失败 | 重试 3 次（2s/4s/8s）→ `exit(1)`，launchd 重拉 |
| SSE 流断 | 3s 重连循环，最多 10 次后 `exit(1)` |
| `tuiBridge.submit` 5s 没捕获新 busy（TUI 未运行 / TUI 已 busy 中） | throw → handler 区分回复：TUI 未运行 → `❌ TUI not running. Please start opencode TUI on your Mac.`；TUI 已 busy → `⏳ TUI is busy. Wait for response or /abort.`（区分方式：检查 `before` 集合是否为空：空=没人在跑=TUI 未运行；非空=有 session busy=TUI 在跑但忙）|
| Telegram polling 409 Conflict | 5s 重试，连续 8 次失败 → `exit(1)` |
| Telegram polling 网络抖动 | 指数退避（1s/2s/4s/.../max 30s）无上限 |
| `session.error` event | 取 `properties.error.message` → 回复 `❌ ${msg}` → 正常结束当前 handler |
| chat handler 120s timeout | AbortController 中断 → 回复 `⏱ Request timed out (120s). Try /abort.` |
| `editMessageText` 400 (相同内容 / 已删) | catch 后吞，console.warn |
| `editMessageText` 429 | 节流间隔翻倍到 2s，下次正常 |
| approval reply 失败 | `answerCbQuery('This request has already been handled.')` |
| 白名单外用户 | `ctx.reply('Unauthorized')` 后 return |

### 5.2 设计原则

1. **launchd 是兜底**：所有"无法恢复"的失败 → `exit(1)` → launchd KeepAlive 拉起。**Bot 不做 PID 锁 / watchdog / ppid 检测**。
2. **失败要响亮**：能告知用户的失败都要回复一条消息，禁止静默吞错。
3. **错误信息走纯文本**：错误提示绝不用 MarkdownV2 解析。
4. **AbortController 是唯一中断机制**：SSE 迭代、timeout、handler 共用一个 signal。

### 5.3 Graceful shutdown

```typescript
process.once('SIGINT',  () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
```

仅此。

### 5.4 日志

- `console.log` → launchd `StandardOutPath` → `/tmp/opencode-telegram-bot.log`
- `console.error` → `StandardErrorPath` → `/tmp/opencode-telegram-bot.err`
- 格式：`[ISO timestamp] [module] message`
- LOG_LEVEL: `debug | info | warn | error`（默认 `info`）

---

## 6. 测试策略

### 6.1 三层

| 层 | 工具 | 范围 | 频率 |
|----|------|------|------|
| 单元 | Vitest + 手写 mock | tui-bridge / event-stream / reply | 每次 commit |
| 契约 | Vitest + 真 opencode @ :4096 | 提交+捕获、SSE 真事件解析 | 手动 / pre-release |
| 手测 | 真 Telegram + 真 opencode | 端到端 chat + approval | MVP 验收 |

### 6.2 单元测试清单

```
tests/unit/
├── tui-bridge.test.ts
│   ├── submit() 返回新 busy 的 sessionID
│   ├── submit() 跳过已 busy 的 (before set)
│   ├── submit() 5s 超时 → throw 'TUI not running'
│   └── /tui/submit-prompt 返回非 true → throw
│
├── event-stream.test.ts
│   ├── session(id) 只收到匹配 sessionID 的事件
│   ├── extractSessionID 处理 3 种 payload 形状
│   ├── 断线后 3s 重连
│   └── stop() 后不再重连
│
└── reply.test.ts
    ├── update() 1s 内重复调用只执行第一次
    ├── finalize() 不节流
    ├── 长消息按 4000 字分片
    └── escapeMarkdownV2 覆盖所有特殊字符
```

目标：~30 单测，覆盖 80%+ 关键路径，不追行覆盖率指标。

### 6.3 MVP 验收清单（手测）

```
□ /start 收到欢迎 + session 提示
□ 普通文本 → TUI 出现这条消息 → Telegram 收到流式回复
□ TUI 上能看到手机发出的消息（验证 TUI mirror 语义）
□ 回复消息 > 4000 字时自动分页
□ TUI 关闭后发消息 → 收到 "TUI not running" 错误（不卡住）
□ opencode 想 bash → Telegram 收到 approval 卡片
□ 点 ✅ Allow Once → bash 继续执行，消息状态变更
□ 在 TUI 上点 approve → Telegram 卡片状态同步更新为 "(from TUI)"
□ /sessions 列出所有 session
□ /abort 中断当前生成
□ launchctl stop 后立即重启（KeepAlive 验证）
□ kill -9 进程后 launchd 5s 内拉起
□ Telegram polling 网络中断 30s 后自动恢复
□ 白名单外用户 → 收到 Unauthorized
```

### 6.4 不做的事

- 不写 telegraf mock 框架（telegraf 自家不稳，mock 易脆）
- 不追求行覆盖率指标
- 不写 docker-compose 集成测试（launchd 是部署方式）

---

## 7. 部署

### 7.1 launchd 模板

`deploy/ai.opencode.telegram-bot.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
                       "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.opencode.telegram-bot</string>
  <key>WorkingDirectory</key>
  <string>/Users/REDACTED/AgentWorks/Code_Opencode/opencode-telegram-bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>dist/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/opencode-telegram-bot.log</string>
  <key>StandardErrorPath</key><string>/tmp/opencode-telegram-bot.err</string>
</dict>
</plist>
```

环境变量（含 `TELEGRAM_BOT_TOKEN`）从 `.env` 文件加载（项目根目录），launchd 不直接放敏感信息。

### 7.2 安装

```bash
cd /Users/REDACTED/AgentWorks/Code_Opencode/opencode-telegram-bot
npm install
npm run build
cp deploy/ai.opencode.telegram-bot.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.opencode.telegram-bot.plist
launchctl start ai.opencode.telegram-bot
```

### 7.3 升级

```bash
git pull
npm install
npm run build
launchctl stop ai.opencode.telegram-bot   # KeepAlive 会自动重拉
```

---

## 8. Phase 2 候选（不在本 spec 范围）

待 MVP 稳定后再排：

- `/files [query]` / `/read <path>` 文件浏览
- `/agent` 卡片选择 4 个自定义 agent（Chat/Plan/Build/Audit）
- `/model list` / `/model set <provider/id>` 模型切换
- 信号推送：opencode 产生重要事件（编辑文件、提交）时主动推 Telegram
- Tailscale 远程模式（OPENCODE_BASE_URL 走 Tailscale IP）

---

## 9. 验收口径

**MVP 视为完成的标准：**

1. §6.3 验收清单全部 ✅
2. `npm test` 全绿且 ≥30 单测
3. launchd 安装后连续 24h 自动运行，无人工干预
4. 至少完成一次真实的"在外面用 Telegram 远程开发，TUI 端可见"的用例
