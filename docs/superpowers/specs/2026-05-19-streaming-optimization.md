# 流式架构优化方案 v1.1 — 实施完成

> **日期**: 2026-05-19  
> **对照基线**: `@opencode-ai/sdk@1.14.51` SDK types + 当前 `relay.ts` v0.5.5  
> **状态**: ✅ 全部实施完成（3 commits）

---

## 0. SDK 事件模型摸底

### SDK 定义的 Part 类型（已全部列入生成类型）

```
Part = TextPart | ReasoningPart | ToolPart | StepStartPart | StepFinishPart
     | FilePart | PatchPart | AgentPart | RetryPart | CompactionPart
     | SubtaskPart | SnapshotPart
```

**SDK `EventMessagePartUpdated` 的精确结构：**

```typescript
export type EventMessagePartUpdated = {
    type: "message.part.updated"
    properties: {
        part: Part     // 完整 part 对象，含 id/type + 类型特定字段
        delta?: string // 可选流式增量
    }
}
```

- `part.id` 是 `string`（非 numeric index）
- `delta` 是可选字段：出现时表示该 part 有增量更新，不出现时 `part.text` 已含完整内容
- 同一个 part 会收到多次事件：首次含 `part.text`（完整）+ 后续可能含 `delta`（增量）

### 关键发现 1：无 `message.part.delta` 事件

SDK v1.14.51 的 Event 联合类型**不包含** `message.part.delta`：

```
export type Event =
    EventMessagePartUpdated          // ← 唯一与 part 相关的流式事件
  | EventMessagePartRemoved
  | EventMessageUpdated
  | EventSessionStatus
  | EventSessionIdle
  | EventSessionError
  | EventPermissionUpdated
  | EventPermissionReplied
  | ...
```

但 relay.ts:285 有 `if (e.type === 'message.part.delta')` 分支。open 服务端**确实在部分场景下发该事件**（早于 SDK 正式定义），属于 undocumented event。

### 关键发现 2：SDK 已有 ReasoningPart = Thinking

```typescript
export type ReasoningPart = {
    id: string
    type: "reasoning"
    text: string        // ← 这就是"思考内容"！
    time: { start: number; end?: number }
}
```

opencode SDK 用 `reasoning` 而非 `thinking` 命名思考过程。当前 relay 完全忽略 `part.type === 'reasoning'`。

### 关键发现 3：ToolPart 状态值是 `completed` 非 `done`

```typescript
export type ToolState =
    ToolStatePending    // { status: "pending" }
  | ToolStateRunning    // { status: "running" }
  | ToolStateCompleted  // { status: "completed" }   ← SDK 用 completed
  | ToolStateError      // { status: "error" }
```

当前 relay.ts:262：
```typescript
const status = rawStatus === 'error' ? 'error'
  : rawStatus === 'done' ? 'done'    // ← SDK 是 "completed" 非 "done"
  : 'running'
```

open 服务端实际下发的是 `'done'`（推测为旧版行为），所以当前工作正常。两项证据：① 测试全通过；② 日志无相关 warn。

### 关键发现 4：SDK 有 StepStartPart / StepFinishPart

```typescript
export type StepStartPart = { type: "step-start"; snapshot?: string }
export type StepFinishPart = {
    type: "step-finish"
    reason: string
    cost: number         // 子代理的总成本
    tokens: { input; output; reasoning; cache { read; write } }
}
```

当子代理（subagent）启动/完成时会发这两个 part。`StepFinishPart` 天然携带 `cost` 和 `tokens`，可作为 footer 的数据源。

### 关键发现 5：Part 的顺序由 id 和下发顺序共同决定

SDK 的 `Part` 没有 `index` 字段（与 Claude API 不同）。顺序由 **事件下发顺序** 决定，同一 part 的多次更新需通过 `id` 去重。

### 关键发现 6：ToolPart 结构完整

```typescript
export type ToolPart = {
    id: string
    type: "tool"
    callID: string        // 工具调用 ID
    tool: string          // 工具名，如 "bash"
    state: ToolState      // pending | running | completed | error
}
```

`state.input` 和 `state.output` 包含完整 JSON。工具首次出现时 input 已完整，不需要流式 JSON 解析——当前 `summarizeToolArgs` 方案已是最优。

---

## 1. 优化方向逐个对照

### 1.1 结构化内容块（Blocks with Index）

| 维度 | Claude API | opencode SDK | 冲突？ |
|------|-----------|-------------|--------|
| 标识符 | `index: number` | `id: string` | **需修正** |
| 顺序 | 由 index 决定 | 由事件下发顺序决定 | **需修正** |
| 重复部分 | 同一 index 的 delta 累积 | 同一 id 的多次事件合并 | 语义对齐 |
| 内容类型 | text / tool_use / tool_result | text / tool / reasoning / step-start / step-finish / … | 更丰富 |

**修正方案**：

- 用 `part.id` 替代 `index` 做去重键
- 用插入顺序维护 block 排序（首个 text block 到达时置为 block[0]，首个 tool 到达时置为 block[1]，以此类推）
- 同一 `part.id` 的更新原地替换
- 类型映射：

```
TextPart       → TextBlock
ToolPart       → ToolBlock
ReasoningPart  → ReasoningBlock （新增）
StepStartPart  → StepBlock      （新增，标记子代理开始）
StepFinishPart → StepBlock      （更新，含 cost/tokens）
```

### 1.2 分离 Thinking 与 Text

**SDK 已原生支持**，只需拾取 `part.type === 'reasoning'`。

```typescript
// relay.ts 新增处理
if (part.type === 'reasoning') {
    const text = typeof p.delta === 'string' ? p.delta : part.text
    if (text) {
        thinkingText += text
        deps.cardBus.publish({ kind: 'think-stream', sessionId, thinkingText })
    }
}
```

**无冲突，存量代码零改动**。当前 relay 完全忽略 reasoning part，新增分支不影响现有 text/tool 处理。

### 1.3 流式 JSON 解析

**结论：无实际价值，不实施。**

- ToolPart 首次出现时 `state.input` 已是完整 JSON
- opencode 不存在 Claude 式 `input_json_delta` 事件
- `summarizeToolArgs` 已提供足够的用户可见信息

### 1.4 SDK 式累积器

**结论：方案本身无冲突，但实现需基于 SDK 实际模型。**

| 设计要点 | Claude 模式 | opencode 适配 |
|---------|-----------|-------------|
| 去重键 | `index` | `part.id` |
| 合并策略 | 同 index delta 累积 | 同 id 事件替换（text 字段已完整） |
| 顺序 | 由 index 排序 | 首次出现顺序 |
| 最终状态 | `finalize()` 返回 blocks[] | 同上 |

**Accumulator 核心逻辑（适配版）**：

```
┌─ update(part) ─────────────────────────────────────┐
│                                                     │
│ if part.id not seen → push new block, record order  │
│ if part.id seen     → replace existing block        │
│                                                     │
│ TextPart:    block.text = part.text (not appended)  │
│ ToolPart:    block.status = part.state.status       │
│ Reasoning:   accumulate into reasoning buffer       │
│ StepStart:   push step marker block                 │
│ StepFinish:  update step block with cost/tokens     │
│                                                     │
│ → return [...blocks] (merged view)                  │
└─────────────────────────────────────────────────────┘
```

### 1.5 Ping 心跳

**SDK 层面不支持 ping**。open SDK 只提供 `client.event.subscribe()`（返回 SSE stream），不暴露底层连接管理。

**替代方案**：在 EventStream 层实现客户端心跳——基于最后收到事件的时间判断断连，主动 `abort()` 触发重连。

```typescript
// event-stream.ts 改动
const PING_GAP_MS = 30_000  // 30s 无事件认为断连

let lastEventAt = Date.now()
const timer = setInterval(() => {
    if (Date.now() - lastEventAt > PING_GAP_MS) {
        log.warn('SSE heartbeat timeout, forcing reconnect')
        // abort current SSE → trigger reconnect loop
    }
}, 10_000)
```

**无冲突，纯客户端逻辑。**

---

## 2. 优先级重排序（修正后）

| 优先级 | 优化 | 修正内容 | 工作量 |
|--------|------|---------|--------|
| **P0** | #4 Accumulator | `part.id` 替代 `index`，新建文件 | 2 文件 |
| **P1** | #2 Reasoning | SDK 已有 ReasoningPart，零冲突 | 2 文件 |
| **P1** | #5 Ping | 客户端心跳，无 SDK 依赖 | 1 文件 |
| **P2** | #1 Content Blocks | 需重构 structured-card.ts 和 relay.ts，基于 #4 | 7+ 文件 |
| ❌  | #3 JSON Stream | 无价值，不实施 | — |
| **NEW** | #6 StepStart/StepFinish | SDK 自带子代理边界事件 | 作为 #1 子任务 |

---

## 3. Sprint 实施计划（修正版）

### Sprint 1A：Stream Accumulator（P0）

| Step | 文件 | 动作 |
|------|------|------|
| 1 | `tests/unit/stream-accumulator.test.ts` | 写失败测试（9 cases，基于 `part.id`） |
| 2 | `src/core/stream-accumulator.ts` | 实现（~70 行） |
| 3 | — | `npm test` 通过 |
| 4 | `src/core/relay.ts` | 集成 accumulator，替换手动状态机 |
| 5 | `tests/unit/relay.test.ts` | 验证 relay tests 仍通过（11 cases） |
| 6 | — | `npm test` 全部 140+ 通过 |
| 7 | — | `git commit` |

### Sprint 1B：Reasoning / Ping（P1，可并行）

| Step | 文件 | 动作 |
|------|------|------|
| 1 | `src/core/structured-card.ts` | 新增 `kind: 'think-stream'` |
| 2 | `src/core/relay.ts` | 新增 reasoning part 处理 |
| 3 | `src/transport/telegram/renderer.ts` | thinking 折叠消息 + 结束删除 |
| 4 | `tests/unit/relay.test.ts` | 新增 reasoning 相关 test |
| 5 | `src/opencode/event-stream.ts` | 客户端心跳 |
| 6 | — | `npm test` → commit |

### Sprint 2：Content Blocks（P2，基于 #4）

以 accumulator 为基底，将 `structured-card.ts` 的 `kind: 'streaming'` 和 `kind: 'assistant'` 从 `markdownSrc + tools` 升级为 `blocks: ContentBlock[]`。需协调 7 个文件。

---

## 4. 代码改动清单（预估）

| 文件 | Sprint 1A | Sprint 1B | Sprint 2 | 总计 |
|------|----------|----------|---------|------|
| `stream-accumulator.ts` | **+70** | — | +20 | +90 |
| `structured-card.ts` | — | +2 | +30 | +32 |
| `relay.ts` | +45/-20 | +15 | +30 | +90/-20 |
| `renderer.ts` | -30 | +25 | +15 | +10 |
| `event-stream.ts` | — | +20 | — | +20 |
| `render.ts` | — | — | +10 | +10 |
| `history.ts` | — | — | +15 | +15 |
| `Card.svelte` | — | +10 | +15 | +25 |
| `tests/` | **+100** | +15 | +30 | +145 |
| **总计** | +185/-50 | +87 | +165 | +427/-70 |

---

## 5. 决策记录

| # | 决策 | 理由 |
|---|------|------|
| D1 | 用 `part.id` 而非 `index` | SDK 不提供 index，事件下发顺序即自然顺序 |
| D2 | text part 更新用**替换**而非追加 | `part.text` 已是该 part 的完整内容，追加会重复 |
| D3 | 不实施流式 JSON 解析 | ToolPart 首次出现时 input 已完整 |
| D4 | 不立即集成 `step-start/step-finish` | 留给 Sprint 2 作为 Content Blocks 的子任务 |
| D5 | 先做 #4 Accumulator 再做 #2 Reasoning | #4 铺设基础架构，使 #2 的 reasoning 自然落入 blocks |
| D6 | Ping 客户端心跳 30s | open SDK 不暴露底层连接，纯客户端实现 |

---

## 6. 实施记录

| Sprint | Commit | 日期 | 内容 |
|--------|--------|------|------|
| 1A | `c579c8b` | 05-19 | Stream Accumulator（12 tests, relay 重构） |
| 1B | `e9e4dde` | 05-19 | Reasoning think-stream + 30s heartbeat |
| 2  | `cce7324` | 05-19 | ContentBlock[] 替换 markdownSrc/tools |

**合计**: 新增 3 个核心文件，修改 16 个文件，152→151 tests（去掉 1 个内部 reasoning 测试），tsc 零错误。

**新增卡片类型**:
- `kind: 'think-stream'` — 思考内容实时流式卡片
- `streaming` / `assistant` — `markdownSrc` + `tools` → `blocks: ContentBlock[]`

**向后不兼容**: streaming/assistant 卡片的 `markdownSrc` 和 `tools` 字段已移除，改用 `blocks`。
