# Sprint 3 — Stability: Delta Accumulation, TCP Hangs, Streaming Removal

Sprint Goal: 修复 v0.5.5 上线后发现的三类稳定性问题（响应截断、连接挂死、Telegram 频繁 429），并移除 Telegram 流式推送以彻底消除 editMessageText 相关故障根因。

Versions: v0.5.6 (2026-05-20) → v0.5.7 (2026-05-21)

## Tasks

### v0.5.6 — 稳定性修复

- [x] **Delta 积累 bug** — `message.part.delta` 是增量文本，非全量。Relay 新增 `partTextAcc` Map 按 partId 追加 delta，再传入 accumulator，修复 Telegram 响应截断问题。
- [x] **finalize() 全面错误处理** — 捕获所有异常，降级 sendMessage 兜底（截断 3800 chars），不再静默丢失响应。
- [x] **TCP 挂死保护** — `sendMessage` / `editMessageText` 统一包 10s timeout（`withTimeout()` / `sendTimed()`），消除连接永久阻塞。
- [x] **429 retry_after 上限** — 超过 5s 的 cooldown 跳过 retry，直接 fallback 到 sendMessage。
- [x] **push.ts fetchSummary 竞态** — session idle 后 opencode 持久化存在延迟；首次 fetch 为空时等 3s 重试一次。
- [x] **移除 Stop 按钮** — streaming/thinking 消息不再附 ⏹ inline keyboard。
- [x] **移除 Part N 标头** — 分页块不再显示 `Part N · done` / `Part N · streaming…`，continuation 改为纯 `⏳`。
- [x] **sendInfo 重试** — 3 次重试 + 2s 间隔，处理 ECONNRESET/ETIMEDOUT。
- [x] 144 tests passing, `npx tsc --noEmit` clean

### v0.5.7 — 移除 Telegram Streaming

- [x] **彻底移除 Telegram 流式推送** — `renderStreaming()` / `renderThinking()` / `retryEdit()` 及所有 throttling/chunking 逻辑删除。Telegram renderer 进入 send-only 模式：`onCard('streaming')` → no-op，只响应 `assistant` / `error` / `info` 三种 card。
- [x] **Thinking card sessionId 竞态修复** — thinking card 在 `sessionId = resolvedId` 赋值后才 publish，确保 sessionId 始终是已解析值；早期 abort controller 恢复。
- [x] **empty text overwrite 防护** — accumulator 对 `text=""` 的 upsert 跳过（SDK 在部分 `part.updated` 事件中发空文本，否则会清除已有内容）。
- [x] 144 tests passing, `npx tsc --noEmit` clean

## Definition of Done

- [x] `npm test` 全绿（144 tests，26 files）
- [x] `npx tsc --noEmit` 无报错
- [x] `npm run build` 生成 `dist/`
- [x] Telegram Bot via launchd 正常运行（`ai.opencode.remote-control.telegram`）
- [x] 响应不再截断，连接不再挂死
- [x] 移除 streaming 后 Telegram 交付率验证通过
