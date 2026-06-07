# 竞品对比: im-hub vs opencode-remote-control

> 调研日期: 2026-06-08 | im-hub 版本: v0.2.12 | opencode-remote-control 版本: v0.5.7

---

## 1. 基本信息

| 维度 | im-hub | opencode-remote-control |
|---|---|---|
| 仓库 | [ceociocto/im-hub](https://github.com/ceociocto/im-hub) | opencode-remote-control |
| 版本 | v0.2.12 | v0.5.7 |
| Stars | 30 | - |
| Commits | 55 | ~200+ |
| 语言 | TypeScript (+ Bun 构建) | TypeScript + Node.js 20+ |
| 发布方式 | `npm install -g im-hub` (全局安装) | `npm start` / `oprc` (本地运行) |
| 测试 | **无测试** (`echo "No tests yet"`) | **144 用例** / 26 文件 |
| 许可证 | MIT | MIT |

---

## 2. 定位差异

| 维度 | im-hub | opencode-remote-control |
|---|---|---|
| **产品定位** | 通用 IM→Agent 多路桥接器 | opencode 专用 SDK-native sidecar bot |
| **口号** | "Universal messenger-to-agent bridge" | "SDK-native multi-transport reference implementation" |
| **核心思路** | 多 Agent + 多 IM 在同一工具内随意切换 | 单 Agent + 单 repo 做到极致深度 |
| **目标用户** | 需要同时用多种 AI 编程助手的开发者 | opencode 重度用户，需要远程控制 |

---

## 3. 架构对比

| 维度 | im-hub | opencode-remote-control |
|---|---|---|
| **架构模式** | Plugin Registry + Message Router + Session Manager | CardBus 发布-订阅 + Transport 抽象 |
| **Agent 集成方式** | `crossSpawn('opencode', ['run', ...])` — CLI 一次性调用 | `client.session.prompt()` — SDK 原生 session 交互 |
| **Session 管理** | 文件持久化 + ChatMessage[] 注入 prompt 前缀 | SessionState + SDK session.messages() + pin/切换 |
| **流式输出** | ❌ 等 CLI 进程结束后拿全文 | ✅ SSE 实时流式 (Web) + Telegram 最终结果 |
| **进程模型** | 1 进程 (im-hub 单 go) | 2 进程 (opencode serve + bot) |
| **配置方式** | `~/.im-hub/config.json` + CLI 向导 | `.env` 文件 + Zod schema |

### im-hub opencode 集成分析

im-hub 的 opencode 适配器仅 **86 行代码** (`src/plugins/agents/opencode/index.ts`)：

```typescript
// 本质上就是 spawn 子进程执行 CLI
const proc = crossSpawn('opencode', ['run', '--format', 'json', prompt], {...})
// 解析 stdout JSONL lines → 拼接 fullText → resolve
proc.on('close', (code) => {
  resolve(fullText) // 返回纯文本
})
```

**因此缺失的能力**：
- 无法复用已有 session（每次都 `opencode run`，全新对话）
- 无法感知 tool call (bash/read/edit/write/grep/...)
- 无法审批 (permission.asked → 无法在 IM 中 respond)
- 无法中止运行中的任务 (/abort)
- 无 cost 统计
- 无 delta 增量流式 (只能等进程结束)
- 无 agent/model 覆写

---

## 4. 功能矩阵

### IM 通道

| 通道 | im-hub | opencode-remote-control |
|---|---|---|
| Telegram | ✅ grammy | ✅ telegraf |
| WeChat | ✅ 扫码登录 (wechaty) | ❌ |
| Feishu | ✅ WebSocket 长连接 | ❌ |
| 钉钉 | 🟡 v0.3 roadmap | ❌ |
| Slack | 🟡 v0.3 roadmap | ❌ |

### Agent 后端

| 后端 | im-hub | opencode-remote-control |
|---|---|---|
| OpenCode | ✅ CLI 调用 (薄封装) | ✅ SDK 深度集成 |
| Claude Code | ✅ `claude run` CLI | ❌ |
| Codex | ✅ codex CLI | ❌ |
| Copilot | ✅ copilot CLI | ❌ |
| 自定义 Agent | ✅ ACP 协议 | ❌ |

### Web UI

| 特性 | im-hub | opencode-remote-control |
|---|---|---|
| 技术栈 | 静态 HTML + 原生 WebSocket | SvelteKit PWA + Chrome Extension |
| 实时流式 | ❌ (无流式) | ✅ WebSocket 实时卡片流 |
| Markdown | `marked@^17` | `marked@^14` + DOMPurify |
| 卡片渲染 | 纯文本 | 7 种卡片组件 (Thinking/Streaming/Assistant/...) |
| 工具折叠 | ❌ | ✅ ToolCallList 组件 |
| 审批弹窗 | ❌ | ✅ ApprovalModal |
| 暗色主题 | ❌ | ✅ |
| PWA | ❌ | ✅ manifest + service worker |
| 双语 | ✅ 中/英文自动检测 | ❌ |
| 移动端 | ❌ | 🟡 响应式 (drawer TODO) |

### 核心功能

| 功能 | im-hub | opencode-remote-control |
|---|---|---|
| 消息提交 | ✅ | ✅ |
| Session 管理 | ✅ `/new` 清上下文 | ✅ pin/切换/复用 + agent/model 覆写 |
| 对话历史 | ✅ ChatMessage[] 前缀注入 | ✅ SDK session.messages() + reconstructHistory |
| 审批流 | ❌ | ✅ Allow once / Always / Reject |
| 工具调用展示 | ❌ | ✅ 渐进折叠 + 内联渲染 + 状态标记 |
| 文件操作跟踪 | ❌ | ✅ /files + /diff |
| Todo 跟踪 | ❌ | ✅ /todo |
| Abort 中止 | ❌ | ✅ /abort |
| 推送通知 | ❌ | ✅ 长任务完成 + 测试失败预警 |
| Cost 统计 | ❌ | ✅ 💰 $X.XX · ↑in ↓out · agent · model |
| 进程守护 | ❌ | ✅ auto spawn opencode + 指数退避 |
| 多用户 | ❌ (无白名单) | ✅ ALLOWED_USER_IDS |
| Chrome Extension | ❌ | ✅ 侧边栏 + 右键菜单 |

---

## 5. 代码质量对比

| 指标 | im-hub | opencode-remote-control |
|---|---|---|
| 测试用例 | 0 | 144 |
| 测试框架 | 无 | Vitest |
| CI/CD | GitHub Actions release | GitHub Actions (tsc + test) |
| Lint/Format | biome | tsc --noEmit |
| 类型安全 | TypeScript | TypeScript strict + Zod |
| 错误处理 | 基础 try/catch | TCP hang 超时、429 限速、重试退避、fallback |
| 日志分级 | console.log | 分级 logger (debug/info/warn/error) |

---

## 6. 依赖对比

| 依赖 | im-hub | opencode-remote-control |
|---|---|---|
| IM SDK | `grammy` | `telegraf` |
| Agent SDK | 无 (直接 spawn CLI) | `@opencode-ai/sdk` |
| Web Server | 内置 (Node http) | `hono@^4` |
| WebSocket | `ws@^8` | `ws@^8` |
| Markdown | `marked@^17` | `marked@^14` |
| 飞书 SDK | `@larksuiteoapi/node-sdk` | - |
| CLI | `commander` | 自建 |
| 配置校验 | 无 | `zod` |
| 前端框架 | 无 (静态 HTML) | SvelteKit 2.60 + Svelte 5.55 |
| 总生产依赖 | 5 | 8 |
| 总 dev 依赖 | 5 | 5 |

---

## 7. 路线图对比

### im-hub 路线图

| 版本 | 内容 |
|---|---|
| v0.1.x (MVP) | WeChat + Claude Code/Codex/Copilot/OpenCode agents |
| v0.2.0 | Feishu + Telegram + Session persistence + ACP |
| v0.2.x | Web Chat + Settings + Bilingual UI |
| v0.3.0 | DingTalk + Slack adapters |

### opencode-remote-control 已完成版本

| 版本 | 内容 |
|---|---|
| v0.1.0 | Telegram bot 基础 (消息/命令/审批) |
| v0.2.0 | 富控制面板 (files/agent/model 命令 + 实时流式) |
| v0.3.0 | SDK 直连 + Transport 抽象 + SessionState |
| v0.4.0 | 产品化 (单命令启动/push 通知/cost footer) |
| v0.5.0 ~ v0.5.7 | Web UI (PWA + Extension) + CardBus 重构 |

### 待规划 (Next Phase)

- 语音/图片附件
- Firefox/Edge Extension 移植
- VS Code Extension
- E2E 测试完善
- PWA 移动端响应式 sidebar drawer

---

## 8. 各自优势

### im-hub 的核心优势

1. **多 Agent 切换**: 一个工具管理 Claude Code / Codex / Copilot / OpenCode / 自定义 ACP agent
2. **本土 IM 覆盖**: 微信扫码登录 + 飞书 WebSocket 长连接，适合国内开发者
3. **全局安装**: `npm i -g im-hub` 开箱即用
4. **ACP 扩展性**: 通过 ACP 协议接入任意外部 Agent
5. **社群运营**: Discord + X + 微信群 + 飞书群

### opencode-remote-control 的核心优势

1. **open code 深度集成**: SDK 原生 session 交互，无法被 CLI spawn 替代 (tool call 感知、审批流、session 复用)
2. **功能完备度**: push 通知 / cost 统计 / diff / todo / context / abort / 多用户白名单
3. **Web UI 品质**: SvelteKit PWA + Chrome Extension，7 种卡片组件 + Markdown + 工具折叠 + 审批弹窗
4. **生产级可靠性**: 144 测试 + TCP hang 防护 + 重试/退避/限速/fallback
5. **架构前瞻**: CardBus pub-sub 架构天然支持未来多 transport 扩展
6. **代码质量**: Zod 配置校验 + 分级日志 + 结构化错误处理

---

## 9. 战略建议

| 场景 | 推荐 |
|---|---|
| 只要 opencode，追求深度集成 + 生产可靠 | **opencode-remote-control** |
| 多个 AI Agent 切换使用，需要微信/飞书 | **im-hub** |
| opencode 为主，偶尔需要其他 agent | 两者可**互补使用** (不冲突，各自独立进程) |
| 学习参考 | im-hub 的 Plugin Registry 模式 + ACP 协议值得关注 |

### 潜在改进方向

对于 opencode-remote-control，可从 im-hub 借鉴：

1. **Plugin Registry 模式** — 将 Transport 注册改为更通用的插件发现机制
2. **多 Agent 接口** — 参考 AgentAdapter interface 设计，预留未来接入其他 agent 的可能
3. **多 IM 通道** — WeChat/Feishu transport 插件的可行性评估 (需 puppeteer/wechaty 等依赖)
4. **全局 npm 安装** — 将 `oprc` 发布到 npm，支持 `npm i -g opencode-remote-control`

> **结论**: 两者不构成直接竞争，im-hub 做"广"（多 agent + 多 IM），opencode-remote-control 做"深"（单 agent 极致集成）。当前 im-hub 的 opencode 集成仅 86 行 CLI spawn，相比我们的完整 SDK 深度不在同一品质层级。
