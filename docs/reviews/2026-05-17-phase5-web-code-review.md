# Phase 5 Web Code Review Report

> 项目：opencode-remote-control (P023)
> 版本：v0.5.3
> 审查范围：Phase 5 Web 组件（后端 + 前端 + Extension）
> 审查方法：三级分层审查（全局摸底 → 逐层深度 → 安全运维）
> 日期：2026-05-17

---

## 一、全局基线

| 指标 | 数值 |
|------|------|
| 后端测试文件 | 26 |
| 后端测试用例 | 145 passed |
| Web 前端测试 | 4 passed (2 files) |
| TypeScript | tsc --noEmit clean |
| Extension build | ✅ |
| PWA build | ✅ |

---

## 二、分层审查

### 2.1 类型系统层

#### 【Important】`web/src/lib/api/types.ts:34` — `info` 类型与后端不一致

前端 `StructuredCard` 的 `info` 变体声明为：
```typescript
| { kind: 'info'; title: string; sections: InfoSection[] }
```
缺少 `sessionId?: string`。而后端 `src/core/structured-card.ts:32` 已于 v0.5.2 增加了该字段（push 通知路由需要）。这会导致前端收到服务端推送的 `info` 卡片时 `'sessionId' in card` 返回 true 但 TypeScript 类型收窄失败，`appendCard` 里的处理也会因缺少字段而走到错误的 else 分支。

**建议**：同步增加 `sessionId?: string`。

#### 【Suggestion】`web/src/lib/api/types.ts` 整体与 `src/core/structured-card.ts` 重复定义

前端 `types.ts` 全量复制了后端的 `StructuredCard`、`ToolCall`、`AssistantMeta`、`InfoSection`、`Button`。两个文件是独立维护的，v0.5.2 后端增加 `sessionId?` 时前端漏同步就是证明。

**建议**：在 web build 的 tsconfig 中增加 paths 映射复用 `../../src/core/structured-card.ts`，或者由后端通过 `/api/version` 或 schema 端点暴露类型供前端生成。

---

### 2.2 后端传输层

#### 【Critical】`src/transport/web/server.ts:54` — `/api/me` 绕过 CF Access 中间件时返回明文 email

```typescript
app.get('/api/me', (c) => {
    const user = c.get('user') as { email: string } | undefined
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    return c.json({ email: user.email })
})
```
路由 `/api/me` 注册在 `app.use('/api/*', cfAccessMiddleware(...))` 下方，中间件链正常。但 `/api/me` 本身如果被直接访问（绕过中间件顺序），会因 `c.get('user')` 为 undefined 返回 401。当前 Hono 的中间件顺序正确，**此项属于防御性评价，非实际漏洞**。

#### 【Important】`src/transport/web/ws-hub.ts:32` — `hello` 消息不含实际数据

```typescript
try { ws.send(JSON.stringify({ type: 'hello', sessions: [] })) } catch {}
```
客户端连接后收到的 `hello` 消息中 `sessions` 固定为空数组，不支持注入实际的 session 列表。虽然 `+layout.svelte` 通过 `api.sessions()` REST 调用获取列表，但双通道获取增加了不一致的可能性（REST 成功但 WS 连接时 session 已变化）。

**建议**：在 `attach` 时注入 session 列表，或移除此字段。

#### 【Suggestion】`src/transport/web/middleware/cf-access.ts:18-31` — `extractJwt` query 解析未解码

```typescript
if (query) {
    const q = new URLSearchParams(query)
    const j = q.get('cf_access_jwt')
    if (j) return j
}
```
`URLSearchParams.get()` 会自动解码 `%` 编码，但 JWT 中的 `.` 和 `-` 不受影响。**此项属于最佳实践建议，非 bug**。

#### 【Suggestion】`src/transport/web/index.ts:66-74` — SPA fallback 的启发式可能误判

```typescript
const last = path.split('/').pop() ?? ''
if (last.includes('.')) return c.notFound()
return c.html(readFileSync(indexHtmlPath, 'utf-8'))
```
用「最后一段是否含 `.`」判断是否为静态资源，会遗漏如 `/session/3.5-upgrade` 等含点号的合法路由。

**建议**：先查文件系统 `existsSync(join(cfg.staticRoot, path))` 再 fallback。

---

### 2.3 前端组件层

#### 【Important】`web/src/lib/components/Card.svelte:1-12` — 卡片分发器不完整

```svelte
{#if card.kind === 'user'}
  <CardUser {card} />
{:else}
  <div class="card placeholder">[{card.kind}]</div>
{/if}
```
只处理了 `user`，其他 7 种 `kind` 全部显示为 `[thinking]` / `[streaming]` 之类的占位符。虽然 `CardStreaming.svelte` 和 `CardAssistant.svelte` 已实现，但 `Card.svelte` 没有引入它们。

**建议**：补全所有 kind 的分发逻辑，至少包含 `thinking` / `streaming` / `assistant` / `error` / `info` / `status` / `approval`。

#### 【Important】`web/src/lib/ws/client.ts:75` — 重连丢失订阅状态

```typescript
ws.onclose = () => {
    clearTimers()
    if (!closed) reconnect()
}
```
`reconnect()` 只重建 WebSocket 连接，不重新发送 `subscribe` 消息。用户在某个 session 页面上观看，断线重连后不会自动重新订阅该 session，导致收不到新的 cards。

**建议**：在 `WsClientOpts` 中增加 `onReconnect` 回调，由 `+layout.svelte` 在重连时重新发送 `subscribe`。

#### 【Important】`web/src/extension/App.svelte:24-30` — Extension 的 WS 消息处理为空

```typescript
createWsClient({ url: `${botUrl.replace(/^http/, 'ws')}/ws`, onMessage: (msg) => {
    if (msg.type === 'hello') {
        // Handle initial session list
    } else if (msg.type === 'card') {
        // Handle card - this would update stores
    }
}})
```
两个分支都是空实现。Extension 侧边栏无法显示任何实时数据。

**建议**：复用 `appendCard` / `sessionList.set` 等 store 操作，或直接复用 PWA 的 `+layout.svelte` 逻辑。

#### 【Suggestion】`web/src/routes/[sessionId]/+page.svelte:12-17` — 自动滚动的响应式依赖过于宽泛

```typescript
$: {
    sessionId
    tick().then(() => {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
    })
}
```
每次 `sessionId` 变化都触发滚动到底部，即使 `cards` 数组未变（如页面初次挂载、从其他 tab 切回）。建议改为依赖 `cards.length` 而非 `sessionId`。

#### 【Suggestion】`web/src/lib/stores/sessions.ts:12-14` — streaming 去重逻辑可能丢数据

```typescript
if (last?.kind === 'streaming' && card.kind === 'streaming') {
    list[list.length - 1] = card
}
```
连续两个 streaming card（如工具状态变更触发的额外 publish）会导致第一个被覆盖。虽然 streaming 是全量快照语义，但如果 relay 在两个 delta 之间同时变更了 tools，第一个 streaming 的 tools 数据会丢失。

---

### 2.4 内核层（relay / card-bus / push）

#### 【Important】`src/core/relay.ts:259-266` — tools 数组可能产生重复条目

```typescript
if (part.type === 'tool' && typeof part.tool === 'string') {
    const status = part.state?.status ?? 'running'
    tools.push({
        tool: part.tool,
        args: summarizeToolArgs(part.tool, part.state?.input ?? {}),
        status: status === 'error' ? 'error' : status === 'done' ? 'done' : 'running',
    })
```
同一个 tool 可能收到多次 `message.part.updated` 事件（状态从 running → done），每次都 `push` 新条目而不是更新已有条目。导致 `tools` 数组中出现多个相同 tool 的记录。

**建议**：通过 `part.id` 去重（如果 SDK 提供），或按 tool 名字 + args 去重。

#### 【Suggestion】`src/core/card-bus.ts:24-26` — 订阅者异常隔离日志级别不足

```typescript
function safe(fn: (c: StructuredCard) => void, c: StructuredCard) {
    try { fn(c) } catch (err) { log.warn('subscriber error', (err as Error).message) }
}
```
异常被隔离是正确的设计。但 `log.warn` 在生产环境可能被忽略。建议在异常中附带 card.kind 和 sessionId 以便追踪。

---

### 2.5 Extension 层

#### 【Important】`web/extension/manifest.json:4` — 版本号过期

```json
"version": "0.5.0"
```
Extension manifest 版本号仍为 0.5.0，未随项目版本更新。

**建议**：构建脚本中自动同步 package.json 版本到 manifest.json。

#### 【Suggestion】`web/extension/background.ts:14` — `sendMessage` 无回调确认

```typescript
chrome.runtime.sendMessage({ type: 'inject-prompt', payload })
```
调用 `sendMessage` 后没有 `catch` 处理。如果侧边栏未打开，消息会丢失且无日志。

---

### 2.6 路由层（Backend API）

#### 【Suggestion】`src/transport/web/routes/message.ts:17` — fire-and-forget 无错误反馈

```typescript
void onMessage(msg)
return c.json({ messageId: msg.messageId })
```
消息提交后立即返回 200，但实际 relay 执行可能失败。客户端无法感知提交后的运行状态异常。

**建议**：保持当前设计（不阻塞 HTTP 响应），但在 relay 内部通过 CardBus error 事件通知前端（现有架构已支持）。

#### 【Suggestion】`src/transport/web/routes/sessions.ts:9` — 过滤逻辑对全新安装不友好

```typescript
const touched = all.filter((s) => state.getSessionCost(s.id) !== undefined)
const visible = touched.length > 0 ? touched : all.slice(0, 10)
```
首次使用的用户没有 `sessionCost` 记录，会看到 session 列表为空（fallback 取前 10 个但 filter 逻辑可能已经截断了）。实际上 `touched.length === 0` → `visible = all.slice(0, 10)`，逻辑正确，但体验略奇怪。

---

## 三、安全审查

| 检查项 | 状态 | 备注 |
|--------|------|------|
| WS 升级认证 | ✅ | `verifyUpgradeJwt` 在 upgrade 前验证 |
| CF Access JWT | ✅ | 3 通道提取（header / query / cookie） |
| Dev bypass 限制 | ✅ | `isLoopback` 仅本地 + 显式开启 |
| API 授权 | ✅ | `/api/*` 全部走 cfAccessMiddleware |
| SPA fallback 信息泄露 | ⚠️ | 非 API 路径统一返回 index.html |
| `send()` throw | ✅ | 符合设计，cards 走 CardBus |
| Extension CSP | ❌ | manifest.json 未配置 `content_security_policy` |
| Token 泄露 | ✅ | `.env` gitignored, `.env.example` 无真实值 |

#### 【Important】Extension CSP 未配置

`web/extension/manifest.json` 缺少 `content_security_policy`。MV3 extension 的侧边栏可以执行任意 JS（从外部 bot URL 加载），如果 bot URL 配置为 HTTP 或被中间人攻击，存在注入风险。

**建议**：增加 `"content_security_policy": { "extension_pages": "script-src 'self'; connect-src https://*" }`。

---

## 四、测试覆盖分析

| 组件 | 测试文件 | 覆盖情况 |
|------|---------|---------|
| `cf-access.ts` | ✅ `cf-access.test.ts` | JWT 验证 + dev bypass |
| `ws-hub.ts` | ❌ 无独立测试 | 仅通过 server.test.ts 间接覆盖 |
| `ws-auth.ts` | ✅ `ws-auth.test.ts` | WS upgrade JWT 验证 |
| `server.ts` | ✅ `server.test.ts` | `/api/me` 401/200 覆盖 |
| `routes/*.ts` | ❌ 无独立测试 | 未直接测试各路由 |
| `push.ts` | ✅ `push.test.ts` | idle / cooldown / rate limit / summary |
| `renderer.ts` | ✅ `renderer.test.ts` | thinking / collapse / finalize / throttle |
| Web 前端组件 | ⚠️ 仅 MarkdownView + ws client | Card / Composer / SessionList 无测试 |

---

## 五、问题汇总

### Critical（0）
无线上阻断级问题。

### Important（7）

| # | 位置 | 问题 |
|---|------|------|
| 1 | `web/src/lib/api/types.ts:34` | `info` 类型缺 `sessionId?`，与后端不同步 |
| 2 | `web/src/lib/components/Card.svelte:1-12` | 卡片分发器未补全 7 种 kind |
| 3 | `web/src/lib/ws/client.ts:75` | 重连后不自动重新订阅 session |
| 4 | `web/src/extension/App.svelte:24-30` | Extension WS 消息处理为空实现 |
| 5 | `web/extension/manifest.json:4` | 缺少 CSP 配置 + 版本号过期 |
| 6 | `src/core/relay.ts:259` | tools 数组重复 push(不更新已存在条目) |
| 7 | `web/src/routes/[sessionId]/+page.svelte:12` | 滚动触发依赖 sessionId 而非 cards.length |

### Suggestion（6）

| # | 位置 | 问题 |
|---|------|------|
| 8 | `web/src/lib/api/types.ts` | 与 `structured-card.ts` 重复定义，建议合并 |
| 9 | `web/src/transport/web/ws-hub.ts:32` | `hello.sessions` 固定为空数组 |
| 10 | `web/src/transport/web/index.ts:66` | SPA fallback 启发式可能误判含 `.` 的路由 |
| 11 | `src/core/card-bus.ts:25` | 订阅者异常日志缺少上下文 |
| 12 | `src/transport/web/routes/sessions.ts:9` | 首次用户 session 列表体验 |
| 13 | `web/src/lib/stores/sessions.ts:12` | streaming 去重可能覆盖中间帧 |

---

## 六、总体评价

Phase 5 Web 组件架构清晰：**Hono + WS → CardBus → SvelteKit** 的分层设计合理，认证链路完整（CF Access JWT → Hono middleware + WS upgrade verify），端到端数据流畅通。

**主要不足集中在前端组件的完善度**：卡片分发器仅实现了 `user` 类型，Extension 的消息处理为骨架代码，WS 重连丢失订阅状态。这些问题不影响后端 → Telegram 的主链路，但会限制 Web UI 的实际可用性。

**建议下阶段优先级**：
1. 补全 `Card.svelte` 分发（P0，影响面最大）
2. 修复 WS 重连订阅（P0，导致断网后 Web 失联）
3. 同步 `info` 类型 + Extension manifest 版本号（P1，维护债）
