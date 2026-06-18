# Phase 3 — In-UI multi-backend switching

> **状态（2026-06-18）**：piece 1–5 已实现并对 opencode+kimi 双后端 host 实测通过，
> web 端界面内切换可演示。piece 6（Telegram 多后端）未做。分支 `phase3-multi-backend`，
> 未并入 main（main 仍停在 Phase 2，tag `pre-phase3` 可回滚）。
>
> - ✅ piece 1 BackendRegistry + state 会话→后端 `cb0dfdf`
> - ✅ piece 2 relay 按会话路由 `ca83288`
> - ✅ piece 3 web 路由多后端 + /api/backends `19bec75`
> - ✅ piece 4 多后端 host（spawn opencode + kimi，接事件源）`51dbc26`
> - ✅ piece 5 前端切换器 + 按会话能力门控 `8b9ba83`
> - ⏳ piece 6 Telegram /backend（其实是把 registry 串进 telegram transport 的较大改动）


## 目标
一个 OCRC 实例同时挂多个后端（opencode + kimi + …），用户在界面里下拉切换；
每个会话归属一个后端。手机开一个地址即可在 opencode↔kimi 间切。

前提已成立：`AgentBackend` 接口（Phase 1）+ `AgentEvent` 事件 seam（Phase 2）已让
relay/transports 与具体后端解耦；`startGlobalEvents({client})` 能让**独立 host**
（非插件）通过 opencode 的 `global.event()` SSE 流拿到 opencode 事件。

## 现状约束（为什么现在切不了）
- 一个实例 = 一个后端，启动时固定。relay 持有单个 `deps.backend`
  (`src/core/relay.ts:13`)，web 所有路由经 `buildServer.opts.backend` 拿到同一个引用，
  state 里没有「会话→后端」的概念。
- 顶栏 chip 只读 `$capabilities.id`，是状态标签不是切换器。

## 核心设计

### 1. BackendRegistry（新 `src/core/agent/registry.ts`）
```
interface BackendRegistry {
  list(): { id: string; capabilities: BackendCapabilities }[]
  get(id: string): AgentBackend | undefined
  default(): AgentBackend
  forSession(sessionId: string): AgentBackend   // 查 state 的会话→后端映射，回退 default
}
```
替换 relay / 路由 / 传输里所有单个 `backend` 引用。

### 2. state：会话→后端映射
`src/core/state.ts` 增 `getSessionBackend(id)/setSessionBackend(id, backendId)`，
持久化 `sessionBackends: Record<sid, backendId>`。新建会话时写入。

### 3. relay：按会话路由
`RelayDeps.backend` → `RelayDeps.registry`。
- prompt（onMessage）：解析目标会话 → `registry.forSession(sid)`；全新一轮用
  「当前选中的后端」。
- abort / getMessageBlocks / hasSession：按会话解析。
- 事件：各后端 `onEvent → relay.handleEvent`（已按 sessionId keyed，无需改）。
  opencode 后端在 host 里没有 onEvent → 用 `startGlobalEvents` 拉 SSE →
  `normalizeOpencodeEvent` → `relay.handleEvent`。

### 4. web
- `buildServer` 收 `registry`；会话型路由（diff/todo/context/abort/message/rename/
  delete/session GET）经 `registry.forSession(sid)` 取后端。
- `/api/capabilities` → `{ backends:[{id,capabilities}], activeBackendId }`；
  新增 `/api/backends`。createSession body 增 `backendId`。
- `listSessions` 跨后端聚合，每条会话带 `backendId`。
- catalog/workspaces/mcp：按选中后端解析（`?backend=` 或 active）。

### 5. 前端
- chip → **下拉切换器**（来源 `/api/backends`）。
- 新建会话选后端（或继承当前 active）。
- 每个会话行显示其后端；`can()` 改为**按所看会话的后端**取能力（当前是全局）。

### 6. Telegram
`/backend` 命令列出/切换「新会话默认后端」；`/status` 显示当前会话后端。

### 7. host 配置
`OCRC_BACKENDS`，如 `opencode@http://localhost:4096, kimi=kimi acp`。
host 为每个实例化后端：opencode 需 SDK client + `startGlobalEvents` 作事件源。

## 工作量（粗估）
| 模块 | 规模 |
|---|---|
| Registry + state 会话→后端 | S |
| relay 按会话路由 | M |
| host 里 opencode 事件源（SSE→normalizer→relay） | M |
| web 路由后端解析 + /api/backends + 能力按会话 | M |
| 前端切换器 + 按会话能力门控 | M |
| Telegram /backend | S |
| 测试 + 对 kimi/opencode 双后端联调 | M |

约 1–2 个专注 session；可用 Pactify 编排（后端核心=claude，web 路由=opencode/deepseek，前端=kimi）。

## 风险/待定
- **会话 id 命名空间**：opencode `ses_…` vs kimi UUID，碰撞概率低，但显式存 `backendId`。
- **新会话选后端的 UX 位置**（下拉旁？新建弹层？）。
- **host 里 opencode 事件**：✅ 已验证（2026-06-18）。独立进程用 SDK
  `createOpencodeServer({port})` 拉起自己的 `opencode serve`，`createOpencodeClient`
  连上后 `client.global.event()` 的 SSE 正常推送（`server.connected` / `session.created`
  / `sync` / …）。关键：**host 自己 spawn 一个 opencode server**（不依赖 hub 那个临时端口
  —— hub 的 serverUrl 是 opencode 注入插件的，对外不可达）。因为 opencode.db 是全局的，
  spawn 出来的 server 看到的是**同一批会话**（probe 里 session.list=2，就是 hub 的会话），
  所以不是孤岛。→ host 的 OpencodeBackend 需要：SDK client + spawn server +
  startGlobalEvents 作事件源。
- **能力从全局变为按会话**：前端 `can()` 要按当前会话后端取值。

## 与 Phase 3 无关的两个便宜收益（可先做）
- 写死的 "opencode" 文案改成跟后端联动（空状态 + 输入框占位）。
- `AcpBackend.listCommands` 从 `available_commands_update` 填上（kimi 已发该列表）。
