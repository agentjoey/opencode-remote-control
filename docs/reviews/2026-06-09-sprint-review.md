# opencode-remote-control 变更复盘 & 架构 Review

**日期**: 2026-06-09  
**来源**: Sidecar → Plugin 模式迁移 + 随后清理  
**状态**: 未提交变更 26 files / +157 -469 lines

---

## 一、两日变更总结

### 已提交变更（6月8-9日）

| Commit | 范围 | 要点 |
|--------|------|------|
| `ff94c75` | Plugin 模式初版 | 新增 `src/plugin/entry.ts`、`config.ts`、CLI `install.ts`/`uninstall.ts`；`package.json` main 指向 `dist/plugin/entry.js` |
| `6073902` | Plugin 改进 | Push 通知事件驱动化、TUI session 轮询、Telegram /config 端点对接 `directory` 参数、CF-Access host spoof 防护、新增 3 个测试文件 |

### 未提交变更（6月9日 — Sidecar 清理）

| 操作 | 文件 | 行数变更 |
|------|------|----------|
| 删除 sidecar 启动器 | `src/launcher/index.ts` `src/launcher/spawn.ts` `tests/unit/spawn.test.ts` | -179 |
| 删除 launchd 部署 | `deploy/` `scripts/install-launchd.sh` `scripts/uninstall.sh` | -78 |
| 重写入口 | `src/index.ts` (115→2 行 re-export) | -113 |
| CLI 默认行为 | `src/cli/index.ts` 默认展示 help，移除 `install-svc` | +22 -24 |
| Init 向导 | `src/cli/init.ts` 移除 `SPAWN_OPENCODE` 询问 + launchd 提示 | +3 -10 |
| Install 修复 | `src/cli/install.ts` `--yes` 模式正确读取 env vars | +10 -5 |
| 脚本清理 | `package.json` 移除 `dev`/`start`/`start:dev`、`install` bin | -3 |
| Relay 改进 | `src/core/relay.ts` root session 优先、tuiSelectedSession 优先、baseUrl normalize | +22 -2 |
| Logger 重构 | `src/utils/logger.ts` console → 文件写入 | +40 -6 |
| Plugin 配置 | `src/plugin/config.ts` devBypass 逻辑修复、baseUrl 默认 `''` | +14 -6 |
| Transport 改进 | Telegram index/handlers/renderer 多项修复、CF-Access 加固 | +55 -10 |
| 测试更新 | `tests/unit/init-wizard.test.ts` 适配无 SPAWN_OPENCODE | +15 -8 |
| 配置清理 | `.env` `.env.example` `.gitignore` `opencode.json` 去 sidecar 化 | +11 -25 |

---

## 二、全局配置冲突排查

### 配置源矩阵

| 位置 | 是否追踪 | 是否含密钥 | 角色 |
|------|----------|-----------|------|
| `~/.config/opencode/opencode.json` | 否 (home dir) | **有** — Bot Token + Minimax API Key | 全局 agent、provider、plugin、MCP |
| `./opencode.json` | **是 (git)** | 无 | 项目 agent model 定义 |
| `./.env` | 否 (gitignore) | **有** — Bot Token + CF 凭证 | 运行时环境变量 |
| `./.env.example` | 是 | 无 (占位符) | 文档模板 |
| `./opencode.json.example` | **否 (?? untracked)** | 无 | Plugin 配置模板 |
| `./config.json` | 否 (gitignore) | 无 | 遗留最小配置 |

### 冲突点

| # | 严重度 | 冲突 | 实际效果 |
|---|--------|------|----------|
| 1 | **高** | `plan` agent model：全局 `minimax/MiniMax-M3` vs 项目 `google/gemini-3.5-flash` | 项目级优先，使用 gemini |
| 2 | **中** | `LOG_LEVEL` 默认：`src/config.ts` = `info`，`src/utils/logger.ts` = `warn` | Plugin 模式日志更少（warn 级别） |
| 3 | **中** | Plugin options 与 `.env` 三个字段**完全重复**：`TELEGRAM_BOT_TOKEN` / `ALLOWED_USER_IDS` / `WEB_ENABLED` | 改一处忘改另一处会不一致 |
| 4 | **低** | `TUI_VISIBLE`：代码默认 `true`，`.env.example` 文档写 `false` | 文档误导 |
| 5 | **低** | `TG_CHUNK_SOFT_LIMIT` / `HARD_LIMIT` 只能通过 `process.env` 设置，plugin options 不支持 | 不一致的配置接口 |

### 缺少项

- `opencode.json.example` 未追踪（新建但未 `git add`）
- `.opencode/opencode.json` 不存在（预期内，但 `.gitignore` 排除了此目录）
- `SSE_HEARTBEAT_MS` 在 `event-stream.ts` 中使用但未写入 `.env.example`
- Plugin options 只写 3 个字段到 `opencode.json`；其他 13+ 字段（port、host、cache size 等）必须通过 env vars 配置

---

## 三、架构与代码 Review

### 3.1 架构层面

| # | 严重度 | 问题 |
|---|--------|------|
| **A1** | **高** | **Dead code 残留** — `src/opencode/event-stream.ts` (160行)、`src/core/tui-sync.ts` (53行)、`src/config.ts` (104行) 在 Plugin 模式下从未执行但仍编译进产物 |
| **A2** | **高** | **`process.exit(1)` 在库代码中** — `event-stream.ts:106` SSE 重连 15 次失败后直接杀宿主进程。Plugin 模式下不会触发此路径，但作为已发布的库代码，极其危险 |
| **A3** | **中** | **Relay 双重事件处理路径** — `relay.ts` 有 SSE 循环（line 250-332）和 Plugin handleEvent（line 422-569）两套独立流水线。行为有微妙差异（如 session.idle 处理方式不同），改一个容易漏另一个 |
| **A4** | **低** | **VERSION 硬编码不一致** — `entry.ts`: `'0.6.0'`、`cli/index.ts`: `'0.6.0'`、`package.json`: `'0.6.0-rc.1'` |

### 3.2 生命周期

| # | 严重度 | 问题 |
|---|--------|------|
| **L1** | **高** | **Transport 就绪无保障** — `entry.ts:69` 发起的 `Promise.all(transports.map(t.start(...)))` 未 await。这意味着 Plugin 返回时 transports 可能尚未就绪。如果 event hook 此时收到事件，消息会丢失 |
| **L2** | **中** | **WebSocket shutdown 无 Graceful drain** — `web/index.ts` 的 `stop()` 直接调用 `wss.close()`，未发送 close frame 给已连接的客户端 |
| **L3** | **中** | **Plugin dispose 后 PluginSessionCtx 泄漏** — `relay.ts` 内部的 `pluginSessions` Map 在 dispose 时未清理，残留的 AbortSignal 定时器可能触发 error card 发布 |
| **L4** | **低** | **Renderer 过早删除** — telegram/index.ts:174 在收到 assistant/error 后立即 `renderers.delete`。如果同一 session 还有后续消息，旧 renderer 的 thinking placeholder 丢失 |

### 3.3 错误处理

| # | 严重度 | 问题 |
|---|--------|------|
| **E1** | **高** | **Event hook 中 relay.handleEvent 无 try/catch** — entry.ts:108,130 直接 `await relay.handleEvent(event)`。若 handleEvent 内抛出异常，会成为 opencode 框架的 unhandled rejection |
| **E2** | **中** | **chatTimeout 4s 偏短** — relay.ts 的 `waitForBusySession` 最多等 4s。大上下文冷启动可能超过此时间，导致重复提交 |
| **E3** | **低** | **Telegram 内部错误消息泄露** — `handlers.ts:112` `ctx.reply('Internal error: ' + err.message)` 直接暴露 Error 详情给用户 |
| **E4** | **低** | **duplicate field** — `relay.ts:547` 出现两次 `p?.sessionID` |

### 3.4 Logger

| # | 严重度 | 问题 |
|---|--------|------|
| **G1** | **中** | **纯文件输出，无终端可见性** — `utils/logger.ts` 现在只写 `~/.opencode/opencode-remote-control.log`，不写 console。必须 `tail -f` 才能看到实时日志 |
| **G2** | **低** | **默认 LOG_LEVEL = warn** — 所有 `log.info()` / `log.debug()` 被静默。sidecar config 曾默认 `info` |
| **G3** | **低** | **mkdirSync 静默失败** — 日志目录创建失败后 fallback 到 `console.error`，可能污染 TUI |

### 3.5 代码质量

| # | 严重度 | 问题 |
|---|--------|------|
| **Q1** | **高** | **大量 `as any` 绕过类型系统** — `entry.ts:85`、`relay.ts:195`、`handlers.ts:805`，SDK 升级可能导致静默 break |
| **Q2** | **中** | **`_approvalCleanup` 挂在 bot 对象上** — `handlers.ts:932` 用 `(bot as any)._approvalCleanup` 临时挂载，非 Telegraf 公开 API |
| **Q3** | **中** | **白名单 fallback id = -1** — `telegram/index.ts:48` 在 `ctx.from` 缺失时默认用 `-1` |
| **Q4** | **低** | **`bool()` 对 typo 静默返回 undefined** — `plugin/config.ts:89` 不抛出验证错误 |

---

## 四、优先修复建议

### P0 — 立即修复
1. **Logger 恢复 console + 文件双写** — 保障 Plugin 启动错误可见性
2. **Logger 默认 `LOG_LEVEL` 改为 `info`** — 与 sidecar 默认一致
3. **Event hook 加 try/catch** — `relay.handleEvent` 调用处包裹错误处理

### P1 — 本次提交前
4. 清理 Dead code（event-stream、tui-sync、config.ts）或标记 `@deprecated`
5. `opencode.json.example` 加入 git
6. `.env.example` 中 `TUI_VISIBLE` 默认值更正
7. 修复 `relay.ts:547` 重复 `p?.sessionID`

### P2 — 后续迭代
8. 考虑 Transport readiness signal — Plugin 不返回直到 transports 就绪
9. 移除 `opencode.json` 中与 `.env` 重复的 plugin options
10. 为 `TG_CHUNK_SOFT/HARD_LIMIT` 添加 plugin options 支持
