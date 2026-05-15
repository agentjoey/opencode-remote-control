# Sprint 2 — Phase 2: Command Cards + Streaming

Sprint Goal: 升级所有 slash 命令为卡片 UX，新增 /files、/agent、/model、/session 命令，实现流式输出。
Spec: `docs/superpowers/specs/2026-05-15-phase2-design.md`

## Tasks

### F5 /session 固定命令（低风险，先做）
- [ ] `/session` 无参数显示当前 session 卡片 + [Unpin] 按钮
- [ ] `/session <id>` 直接 pin 到指定 session
- [ ] `/sessions` 每条加 `[Pin this]` inline button
- [ ] `registerCallbacks()` 架构（`src/bot/handlers/callbacks.ts`）
- [ ] `setLastSessionId` 支持 `undefined`（unpin）
- [ ] 测试

### 现有命令卡片化（零风险）
- [ ] `/status` → HTML card + `[Refresh]` + `[Abort]`（isGenerating 时）
- [ ] `/start` / `/help` → HTML card + `[Check status]` 按钮
- [ ] `/current` → HTML card（已有，格式升级）
- [ ] 统一 `parse_mode: 'HTML'`
- [ ] 测试

### F2 /files 命令
- [ ] 现场验证 tool-invocation part 的字段路径（toolName / state.input.path）
- [ ] 实现命令（emoji 图标 + 截断 >15 条）
- [ ] 加入 `setMyCommands`
- [ ] 测试

### F3 /agent 命令
- [ ] 验证 `GET /app/agents` 返回结构
- [ ] 验证 agent switch API（PATCH /session 或其他）
- [ ] 实现列表卡片 + inline keyboard
- [ ] 实现 `agent:switch:` callback
- [ ] 测试

### F4 /model 命令
- [ ] 验证 `GET /config/providers` 返回结构
- [ ] 验证 model switch API
- [ ] 实现列表卡片（按 provider 分组）+ inline keyboard
- [ ] 实现 `model:switch:` callback
- [ ] 测试

### F1 流式输出（最后做，风险最高）
- [ ] 现场验证 `message.part.updated` + `message.part.delta` event shape
- [ ] 在 chat.ts for-await 累积 text deltas，增量 update Telegram 消息
- [ ] `STREAM_OUTPUT` env var 开关
- [ ] 保留 fallback：无 delta 时走 SDK fetch
- [ ] 测试

## Definition of Done
- [ ] `npm test` 全绿（含新测试）
- [ ] `npx tsc` 无报错
- [ ] 每个命令冒烟测试：卡片正确显示，inline buttons 可点击
- [ ] 14.3 基础对话 + 14.9 /abort 无回归
