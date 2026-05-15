# Sprint 2 — Phase 2: Command Cards + Streaming

Sprint Goal: 升级所有 slash 命令为卡片 UX，新增 /files、/agent、/model、/session 命令，实现流式输出。
Spec: `docs/superpowers/specs/2026-05-15-phase2-design.md`

## Tasks

### F5 /session 固定命令（低风险，先做）
- [x] `/session` 无参数显示当前 session 卡片 + [Unpin] 按钮
- [x] `/session <id>` 直接 pin 到指定 session
- [x] `/sessions` 每条加 `[Pin this]` inline button
- [x] `registerCallbacks()` 架构（`src/bot/handlers/callbacks.ts`）
- [x] `setLastSessionId` 支持 `undefined`（unpin）
- [x] 测试

### 现有命令卡片化（零风险）
- [x] `/status` → HTML card + `[Refresh]` + `[Abort]`（isGenerating 时）
- [x] `/start` / `/help` → HTML card + `[Check status]` 按钮
- [x] `/current` → HTML card（已有，格式升级）
- [x] 统一 `parse_mode: 'HTML'`
- [x] 测试

### F2 /files 命令
- [x] 现场验证 tool-invocation part 的字段路径（toolName / state.input.path）
- [x] 实现命令（emoji 图标 + 截断 >15 条）
- [x] 加入 `setMyCommands`
- [x] 测试

### F3 /agent 命令
- [x] 验证 `GET /agent` 返回结构
- [x] 验证 agent switch API（POST /session + { agent }）
- [x] 实现列表卡片 + inline keyboard
- [x] 实现 `agent:switch:` callback
- [x] 测试

### F4 /model 命令
- [x] 验证 `GET /config/providers` 返回结构
- [x] 验证 model switch API（PATCH /config + { model }）
- [x] 实现列表卡片（按 provider 分组）+ inline keyboard
- [x] 实现 `model:switch:` callback
- [x] 测试

### F1 流式输出（最后做，风险最高）
- [x] 现场验证 `message.part.updated` + `message.part.delta` event shape
- [x] 在 chat.ts for-await 累积 text deltas，增量 update Telegram 消息
- [x] `STREAM_OUTPUT` env var 开关
- [x] 保留 fallback：无 delta 时走 SDK fetch
- [x] 测试

## Definition of Done
- [x] `npm test` 全绿（51 tests）
- [x] `npx tsc` 无报错
- [x] 每个命令冒烟测试通过
- [x] 14.3 基础对话 + 14.9 /abort 无回归
