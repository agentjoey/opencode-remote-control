# Phase 5 Web — Work Items (from code review 2026-05-17)

> 来源：`docs/reviews/2026-05-17-phase5-web-code-review.md`
> 排序：按优先级 (P0 > P1 > P2)，同级按工作量

---

## P0 — 阻断用户体验

### [WI-01] Card.svelte 补全卡片分发

- **位置**: `web/src/lib/components/Card.svelte`
- **现状**: 只渲染 `kind:'user'`，其他 7 种卡片显示为 `[thinking]` 等占位符
- **目标**: 引入 `CardStreaming`, `CardAssistant`, `CardError`, `CardInfo`, `CardStatus`, `CardThinking`, `CardApproval` 组件（缺失的创建），分发到对应的 svelte 组件
- **验证**: Web UI 上能看到所有类型卡片的真实渲染
- **估时**: 2h

### [WI-02] WS 重连后自动重新订阅

- **位置**: `web/src/lib/ws/client.ts:85-92` + `web/src/routes/+layout.svelte`
- **现状**: `reconnect()` 只重建连接，不重新发送 `subscribe` 消息。断网恢复后收不到新卡片
- **目标**: `WsClientOpts` 增加 `onReconnect` 回调，`+layout.svelte` 在重连时重新 `send({ type: 'subscribe', sessionId })`
- **验证**: 断网 → 恢复 → 卡片流继续接收
- **估时**: 1h

### [WI-03] Extension 侧边栏 WS 消息处理

- **位置**: `web/src/extension/App.svelte:24-30`
- **现状**: `onMessage` 两个分支均为空实现，侧边栏无实时数据
- **目标**: 复用 `appendCard` / `sessionList.set` 等 store 操作；`subscribe` 当前 session；`onReconnect` 恢复订阅
- **验证**: Extension 侧边栏能看到实时卡片流
- **估时**: 1.5h

---

## P1 — 功能缺陷 / 维护债

### [WI-04] 前端 info 类型同步 sessionId

- **位置**: `web/src/lib/api/types.ts:34`
- **现状**: 前端 `info` 变体缺少 `sessionId?: string`，与后端 `src/core/structured-card.ts:32` 不同步
- **目标**: 增加 `sessionId?: string`
- **验证**: `appendCard` 对 info 卡片行为正确
- **估时**: 10min

### [WI-05] Extension manifest 版本号同步 + CSP

- **位置**: `web/extension/manifest.json`
- **现状**: 版本号硬编码 `0.5.0`，缺 `content_security_policy`
- **目标**: 构建脚本自动同步版本号；增加 `"content_security_policy": { "extension_pages": "script-src 'self'; connect-src https://*" }`
- **验证**: Extension 加载后版本号与 package.json 一致
- **估时**: 30min

### [WI-06] 自动滚动依赖修正

- **位置**: `web/src/routes/[sessionId]/+page.svelte:12-17`
- **现状**: 每次 `sessionId` 变化都滚到底部（包括初次挂载、切回 tab）
- **目标**: 改为依赖 `cards.length` 且只在新卡片增加时滚动
- **验证**: 切 tab 回页面时不会跳到顶部
- **估时**: 20min

### [WI-07] relay tools 去重

- **位置**: `src/core/relay.ts:259-266`
- **现状**: 同一 tool 的 `message.part.updated` 每次 `push` 新条目而非更新已存在条目
- **目标**: 通过 `part.id` 或 `tool+args` 去重更新
- **验证**: 工具列表不出现重复项目
- **估时**: 1h

---

## P2 — 体验优化 / 架构改进

### [WI-08] 前端类型复用

- **位置**: `web/src/lib/api/types.ts`
- **现状**: 与 `src/core/structured-card.ts` 重复定义，各自维护
- **目标**: tsconfig paths 映射复用后端类型，或构建脚本同步生成
- **验证**: 删除前端重复定义后 `web/` 编译通过
- **估时**: 1h

### [WI-09] hello 消息注入 session 列表

- **位置**: `src/transport/web/ws-hub.ts:32`
- **现状**: `hello.sessions` 固定为空数组
- **目标**: `attach` 时传入 session 列表
- **验证**: 客户端 onMessage 收到非空 sessions
- **估时**: 30min

### [WI-10] SPA fallback 优化

- **位置**: `src/transport/web/index.ts:66-74`
- **现状**: 用「末尾段是否含 `.`」判断动静资源，可能误判含点号的路由
- **目标**: 先查文件系统 `existsSync` 再 fallback
- **验证**: 带点号的路由正常渲染 SPA
- **估时**: 20min

### [WI-11] streaming 去重逻辑优化

- **位置**: `web/src/lib/stores/sessions.ts:12-14`
- **现状**: 连续两个 streaming 卡片可能覆盖中间帧
- **目标**: 仅当 `markdownSrc` 或 `tools` 不同时替换
- **验证**: 工具状态变更的中间帧不丢失
- **估时**: 15min

### [WI-12] card-bus 异常日志增强

- **位置**: `src/core/card-bus.ts:25`
- **现状**: 异常日志无 card.kind / sessionId
- **目标**: 附加 `card.kind` 和 sessionId
- **验证**: 日志可定位出错的订阅者
- **估时**: 10min

---

## 汇总

| 优先级 | 数量 | 估时 |
|--------|------|------|
| P0 | 3 | 4.5h |
| P1 | 4 | 2h |
| P2 | 5 | 2.25h |
| **合计** | **12** | **8.75h** |
