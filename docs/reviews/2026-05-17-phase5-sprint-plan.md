# Phase 5 Web — Sprint Plan (2026-05-17)

> 来源：`2026-05-17-phase5-code-review.md` + `2026-05-17-phase5-work-items.md` + 当前 Web UI hang
> 范围：v0.5.4 → v0.5.5 收尾（含 hang 修复 + review 12 项）
> 估时：~11h（2 个工作日）
> 注：根 `package.json` 已是 0.5.4；`web/package.json` 与 `web/extension/manifest.json` 仍在 0.5.0，WI-05 一并同步
> 验证基线：后端 145 unit tests + 前端 4 tests 全绿；E2E 手动验证 CF Access → 点击 session → 发消息 → 收 cards → 断网重连

---

## 排期

| Day | 块 | 时长 | 任务 |
|----|----|------|----|
| Day 1 上午 | P0 阻断 | 2h | WI-00 |
| Day 1 下午 | P0 阻断 | 4.5h | WI-01, WI-02, WI-03 |
| Day 2 上午 | P1 维护债 | 2h | WI-04, WI-05, WI-06, WI-07 |
| Day 2 下午 | P2 优化 | 2.25h | WI-08, WI-09, WI-10, WI-11, WI-12 |
| Day 2 末 | 验证收尾 | 0.5h | 测试 + OPS.md + 版本号 |

---

## P0 — 阻断用户体验

### [WI-00] 修复 Web UI 点击 session 后主线程 hang ⚠️ 新增

- **症状**：用户在 `/` 路径点击 sidebar 任意 session 后，console 打印 `[layout] fetching history for ses_xxx` 之后浏览器主线程卡死，累积 1900+ `setTimeout handler took Nms` violation。`/api/session/:id` 在后端 200 返回但 fetch().then 永远不触发，[sessionId] 页面不 mount。
- **根因猜测**：Svelte 5 + SvelteKit 2.60 + adapter-static SPA 模式下，`+layout.svelte` 的 `page.subscribe` 回调内 `activeSession.set(id)` 触发 SessionList 重渲染（`class:active={$activeSession === s.id}`），与 navigation 期间 page store 的多次更新构成 reactive effect 循环；Svelte 5 `infinite_loop_guard` 在 `flush_count > 1000` 抛 `effect_update_depth_exceeded`，但错误被 SvelteKit error boundary 静默吞掉。
- **修复**（路径 2 - 直接试修）：
  1. `web/src/routes/+layout.svelte`：删除全局 `activeSession` store 订阅，改用 SvelteKit 的 `afterNavigate(({ to }) => ...)` 触发 `api.history(id)` + WS subscribe
  2. `web/src/lib/components/SessionList.svelte`：`class:active` 改用 `$page.params.sessionId === s.id`；移除 `on:click={() => activeSession.set(s.id)}`（导航本身由 `<a href>` 完成）
  3. `web/src/lib/stores/activeSession.ts`：保留 cookie 持久化但不再作为响应式数据源（或整体删除）
  4. `web/src/routes/[sessionId]/+page.svelte`：滚动 effect 改依赖 `cards.length` 而非 `sessionId`（与 WI-06 合并完成）
- **验证**：
  - 重 build → 完全关闭 incognito → 重开 → 登录 → 点击 sidebar → 5s 内 cards 显示
  - 切换 session 不卡死
  - 浏览器 Performance 录制 5s，无超过 50ms 的 setTimeout handler
- **估时**：2h
- **风险回滚**：如果不是这套问题，回到路径 1（增量加 log 诊断）

### [WI-01] Card.svelte 补全卡片分发

- **位置**：`web/src/lib/components/Card.svelte`
- **现状**：当前为 hang 排查临时只渲染 `kind:'user'`，其他 7 种 kind 显示占位符
- **目标**：恢复 import 7 个组件（`CardThinking`/`CardStreaming`/`CardAssistant`/`CardError`/`CardInfo`/`CardStatus`/`CardApproval`），缺失的现场补一个最小实现。Approval 仍由 `+layout.svelte` 的 modal 处理，Card 不渲染。
- **验证**：发一条消息，能依次看到 user → thinking → streaming → assistant 真实渲染
- **估时**：2h

### [WI-02] WS 重连后自动重新订阅

- **位置**：`web/src/lib/ws/client.ts:85-92` + `web/src/routes/+layout.svelte`
- **现状**：`reconnect()` 只重建连接，不重发 `subscribe`
- **目标**：`WsClientOpts` 增加 `onReconnect` 回调；`+layout.svelte` 在 `onReconnect` 内对当前 sessionId 重发 `subscribe`
- **验证**：DevTools 断网 5s → 恢复 → 后续 push 仍能收到
- **估时**：1h

### [WI-03] Extension 侧边栏 WS 消息处理

- **位置**：`web/src/extension/App.svelte:24-30`
- **现状**：两个分支均为空实现
- **目标**：复用 `appendCard` / `sessionList.set`；`subscribe` 当前 session；接 `onReconnect`
- **验证**：在 Chrome 加载 unpacked extension → 侧边栏看到实时卡片
- **估时**：1.5h

---

## P1 — 功能缺陷 / 维护债

### [WI-04] 前端 info 类型同步 sessionId

- `web/src/lib/api/types.ts:34` `info` 变体加 `sessionId?: string`
- 估时：10min

### [WI-05] Extension manifest 版本号同步 + CSP

- `web/extension/manifest.json`：构建脚本注入 `version`（读 root `package.json`）；增加 `"content_security_policy": { "extension_pages": "script-src 'self'; connect-src https://*" }`
- 估时：30min

### [WI-06] 自动滚动依赖修正

- `web/src/routes/[sessionId]/+page.svelte:12-17`：依赖改 `cards.length`
- 与 WI-00 合并完成
- 估时：20min（含在 WI-00）

### [WI-07] relay tools 去重

- `src/core/relay.ts:259-266`：通过 `part.id` 去重（无 id 时按 `tool+args` hash）
- 加 unit test
- 估时：1h

---

## P2 — 体验优化 / 架构改进

### [WI-08] 前端类型复用后端

- `web/tsconfig.json`：paths 映射 `$shared/*` 到 `../src/core/*`
- 删除 `web/src/lib/api/types.ts` 重复定义，改 `export type { ... } from '$shared/structured-card.js'`
- 估时：1h

### [WI-09] hello 消息注入 session 列表

- `src/transport/web/ws-hub.ts:32`：`attach()` 传入 session 列表
- 估时：30min

### [WI-10] SPA fallback 优化

- `src/transport/web/index.ts:66-74`：先 `existsSync(join(cfg.staticRoot, path))` 再 fallback
- 估时：20min

### [WI-11] streaming 去重逻辑优化

- `web/src/lib/stores/sessions.ts:12-14`：仅当 `markdownSrc` 或 `tools` 不同时替换
- 估时：15min

### [WI-12] card-bus 异常日志增强

- `src/core/card-bus.ts:25`：附加 `card.kind` 和 `sessionId`
- 估时：10min

---

## 验证 & 收尾（0.5h）

- [x] `npm test` 全部 140 测试通过（含新增 WI-07）
- [x] `cd web && npm test` 4 用例通过
- [x] `npm run build && cd web && npm run build` 无错误
- [ ] 手动 E2E checklist：
  - [ ] CF Access 登录 → / 首页正确显示 "No active session"
  - [ ] sidebar 点击 session → 5s 内 cards 渲染（WI-00）
  - [ ] 发消息 → 看到 user → thinking → streaming → assistant 完整链路（WI-01）
  - [ ] DevTools 断网 5s → 恢复 → cards 继续接收（WI-02）
  - [ ] Extension 加载 → 侧边栏实时流（WI-03）
  - [ ] Approval 卡片弹 modal → 三选项工作
- [x] 根 `package.json` 版本 → 0.5.5
- [x] `web/package.json` 版本 → 0.5.5
- [x] `web/extension/manifest.json` 版本 → 构建时自动同步
- [x] `docs/OPS.md` 追加 v0.5.5 changelog

---

## 汇总

| 优先级 | 数量 | 估时 |
|--------|------|------|
| P0 | 4 (含 WI-00) | 6.5h |
| P1 | 4 | 2h |
| P2 | 5 | 2.25h |
| 验证 | - | 0.5h |
| **合计** | **13** | **11.25h** |

> WI-00 一旦失败回到路径 1（增量 log 诊断），总工时会延长 0.5～1h。
