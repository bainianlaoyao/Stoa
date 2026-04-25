---
title: Session ID Reconciliation — Event-Driven External ID Tracking
status: proposed
date: 2026-04-25
review-revision: 3
approach: breaking-change
depends-on:
  - provider-capability-contract.md
  - provider-observable-information.md
---

# Session ID Reconciliation — Event-Driven External ID Tracking

## Problem

`externalSessionId` 在 session 创建后被视为不可变。如果用户在 CLI 内部执行 `/new`、`/clear`、`.resume` 等命令，provider 会切换到新的内部会话，但 Stoa 持有的 `externalSessionId` 仍然指向旧会话。下次应用重启时 `--resume <stale-id>` 会恢复到错误的对话。

**当前盲区**：

- `hook-event-adapter.ts` — 从 Claude Code hook POST body 提取了 8 个字段（`hook_event_name`, `model`, `last_assistant_message`, `assistant_message`, `summary`, `tool_name`, `error_details`, `error`），但忽略了 `session_id`（`:11-35`）
- `notify-stoa.mjs`（Codex）— notify payload 包含 `thread-id`，但只提取了 `type` 和 `turn-id`（`:63-76`）
- `applySessionEvent()` — 盲覆盖 `externalSessionId`，不做 diff（`:313-315`）
- `SessionStatusEvent` — 不携带 `externalSessionId`，renderer 无法从事件流中获知 ID 变更

## Assumptions

**A1. `body.session_id` 是 Claude Code 的会话 ID（裸 UUID），与 Stoa 内部 ID 不同**

| 来源 | 值格式 | 含义 |
|------|--------|------|
| `x-stoa-session-id` header | `session_<uuid>` | Stoa 内部 ID，webhook server 用于路由（`:64`） |
| `body.session_id`（POST body 公共字段） | `<uuid>` | Claude Code 当前活跃会话 ID |

本设计只用 body 字段做 reconciliation。

**A2. Claude Code `body.session_id` 反映当前活跃会话**

当用户执行 `/clear` 或 `/resume` 后，后续 hook 事件的 `session_id` 反映新会话。

> **风险标记**: 基于官方文档推理，未经 live test 验证。Phase 1 后应集成测试确认。

**A3. `--session-id` 可能是未公开 flag**

如果该 flag 不生效，首条 hook 事件的 `session_id` 与 seeded UUID 不同，reconciliation 逻辑将此视为首次 assignment。无论是否生效，系统行为均正确。

## Design Goals

1. **每条 incoming event 都做对账** — 不需要 polling
2. **Renderer 始终持有最新 external ID** — 每个 `SessionStatusEvent` 都带 `externalSessionId`，不依赖单独的对账通道
3. **Breaking change** — 不做向后兼容，重新设计 `SessionStatusEvent` 和 `pushSessionEvent` 签名
4. **单一职责** — 对账逻辑在 `ProjectSessionManager`，controller 只负责传递

## Core Mechanism: Extract-then-Reconcile

理论基础：Event Sourcing（[Fowler 2005](https://martinfowler.com/eaaDev/EventSourcing.html)）+ Optimistic Concurrency Control（[Azure](https://learn.microsoft.com/en-us/azure/architecture/patterns/optimistic-concurrency)）。

```
Provider CLI event fires
  → sidecar/hook/notify delivers event to webhook server
  → adapter extracts provider's current session_id from payload
  → canonical event carries externalSessionId
  → manager.applySessionEvent() compares with stored value, updates if different
  → controller reads session snapshot, pushes SessionStatusEvent (always includes externalSessionId)
  → renderer always has current externalSessionId
```

三个 provider 的事件 payload 中都已包含当前 session ID，只是 Stoa 没读：

| Provider | Payload 中的 session ID 字段 | Stoa 当前是否提取 |
|----------|---------------------------|------------------|
| Claude Code | `body.session_id`（所有 hook 公共字段） | **否** |
| Codex | `parsed['thread-id']`（notify payload） | **否** — 选择 notify 是因为 Codex hooks 在 Windows 上被禁用 |
| OpenCode | `event.properties?.sessionID`（所有 sidecar 事件） | **是** |

## Breaking Changes

### B1. `SessionStatusEvent` 增加 `externalSessionId`（非可选）

**文件**: `src/shared/project-session.ts:139-143`

```ts
// 当前
export interface SessionStatusEvent {
  sessionId: string
  status: SessionStatus
  summary: string
}

// 改为
export interface SessionStatusEvent {
  sessionId: string
  status: SessionStatus
  summary: string
  externalSessionId: string | null
}
```

**理由**: `SessionSummary.externalSessionId` 已经是 `string | null`（`:39`）。事件流应反映 session 的完整状态，renderer 不应猜。

**影响的 consumer**:

| Consumer | 文件 | 改动 |
|----------|------|------|
| `preload/index.ts onSessionEvent` | `:84-88` | 类型自动扩展，无需改动（透传） |
| `App.vue onSessionEvent handler` | `:108-113` | 传递 `event.externalSessionId` 到 store |
| `TerminalViewport.vue onSessionEvent` | `:181-184` | 仅读 `status`，无需改动 |

### B2. `pushSessionEvent` 签名变更

**文件**: `src/main/session-runtime-controller.ts:95-103`

```ts
// 当前
private pushSessionEvent(sessionId: string, status: SessionStatus, summary: string): void {
  win.webContents.send(IPC_CHANNELS.sessionEvent, { sessionId, status, summary })
}

// 改为 — 从 manager snapshot 读取 externalSessionId
private pushSessionEvent(sessionId: string, status: SessionStatus, summary: string): void {
  const session = this.manager.snapshot().sessions.find(s => s.id === sessionId)
  win.webContents.send(IPC_CHANNELS.sessionEvent, {
    sessionId,
    status,
    summary,
    externalSessionId: session?.externalSessionId ?? null
  })
}
```

**理由**: controller 已有 `this.manager` 引用，且 `markSessionRunning` 已从 snapshot 读取 status/summary。统一从 snapshot 读取 `externalSessionId` 消除了调用方传参的负担，保证 `SessionStatusEvent` 始终反映 manager 的真实状态。

**唯一额外开销**: 每次 `pushSessionEvent` 做 `snapshot().sessions.find()`。当前代码已在 `markSessionRunning`（`:52`）和 `pushObservabilitySnapshots`（`:117`）中做同样的 find。这是 O(n) 但 n 极小（活跃 session 数）。

### B3. `applySessionEvent` 返回值变更

**文件**: `src/core/project-session-manager.ts:302-318`

```ts
// 当前
async applySessionEvent(
  sessionId: string, status: SessionStatus, summary: string, externalSessionId?: string | null
): Promise<void>

// 改为
async applySessionEvent(
  sessionId: string, status: SessionStatus, summary: string, externalSessionId?: string | null
): Promise<{ reconciled: boolean }>
```

返回 `{ reconciled: true }` 表示 `externalSessionId` 发生了对账更新。调用方可用于日志/observability。

**影响的调用链**:

| 调用方 | 文件 | 行号 | 需要改动 |
|--------|------|------|---------|
| `SessionRuntimeController.applySessionEvent` | `session-runtime-controller.ts` | `:69` | 捕获返回值用于 log |
| `SessionEventBridge.onEvent` → 通过 controller 间接调用 | `session-event-bridge.ts` | `:51` | 无需改动（controller 层处理） |
| `markSessionStarting`（内部调用） | `project-session-manager.ts` | `:321` | 忽略返回值 |
| `markSessionRunning`（内部调用） | `project-session-manager.ts` | `:337` | 忽略返回值 |
| `markSessionExited`（内部调用） | `project-session-manager.ts` | `:347` | 忽略返回值 |
| 测试文件 | `*-controller.test.ts`, `*-bridge.test.ts`, `*-manager.test.ts` | 多处 | mock 返回值 |

### B4. `AppliedSessionEvent` 类型不变

**文件**: `src/main/session-runtime-controller.ts:18-23`

`AppliedSessionEvent.externalSessionId` 已经是 `string | null | undefined`。无需改动。

## Provider-Specific Changes

### 1. Claude Code — 提取 `body.session_id`

**文件**: `src/core/hook-event-adapter.ts`

在 `adaptClaudeCodeHook()` 返回的 payload 中增加 `externalSessionId`:

```ts
payload: {
  status,
  summary: hookEventName,
  ...(model ? { model } : {}),
  ...(snippet ? { snippet } : {}),
  ...(toolName ? { toolName } : {}),
  ...(error ? { error } : {}),
  ...(hookEventName === 'PermissionRequest' ? { blockingReason: 'permission' } : {}),
  ...(body.session_id ? { externalSessionId: String(body.session_id) } : {}),  // NEW
}
```

不需要新增 hook 注册。现有 5 个 hook 在用户切换会话后的第一次交互时都会携带新 `session_id`。

> **已知不一致**: adapter 的 status mapping 包含 `SessionStart` → `'running'`（`:17`），但该 hook 未在 settings.local.json 中注册。预存问题，与本设计无关。

### 2. Codex — 提取 `thread-id`

**文件**: `src/extensions/providers/codex-provider.ts`（notify sidecar 模板）

```js
// notify-stoa.mjs — 改动
payload: {
  status: 'turn_complete',
  summary: String(parsed.type),
  externalSessionId: parsed['thread-id'] ?? undefined  // NEW
}
```

### 3. OpenCode — 已就绪

**文件**: `src/extensions/providers/opencode-provider.ts`

Sidecar 已经在每条事件中提取 `event.properties?.sessionID` 写入 `payload.externalSessionId`。无需改动。

> **FRAGILE 假设**: 假设 `event.properties?.sessionID` 在 opencode 进程内切换 session 时会变化。此假设未被官方确认。如果不变化，OpenCode 的 reconciliation 退化为 no-op。

## Reconciliation Logic

### `applySessionEvent()` 内部

**文件**: `src/core/project-session-manager.ts:302-318`

```ts
async applySessionEvent(
  sessionId: string,
  status: SessionStatus,
  summary: string,
  externalSessionId?: string | null
): Promise<{ reconciled: boolean }> {
  const session = this.state.sessions.find(s => s.id === sessionId)
  if (!session) return { reconciled: false }

  session.status = status
  session.summary = summary

  let reconciled = false
  if (externalSessionId !== undefined && externalSessionId !== null) {
    if (session.externalSessionId !== null && session.externalSessionId !== externalSessionId) {
      // 对账: ID 不一致，用户在 CLI 内切换了会话
      reconciled = true
    }
    // 无论是否对账，都更新为最新值
    session.externalSessionId = externalSessionId
  }

  session.updatedAt = new Date().toISOString()
  await this.persist()
  return { reconciled }
}
```

**三条路径**:

| 条件 | 行为 | 返回 |
|------|------|------|
| `externalSessionId` 为 undefined/null | 不修改 | `{ reconciled: false }` |
| `session.externalSessionId === null` | 首次 assignment | `{ reconciled: false }` |
| `session.externalSessionId !== externalSessionId` | 对账更新 | `{ reconciled: true }` |
| `session.externalSessionId === externalSessionId` | 一致，no-op | `{ reconciled: false }` |

### `resolveSessionId()` 不变

`resolveSessionId()` 的职责是从 canonical event 中提取 Stoa 内部 session ID 用于路由。与 external ID reconciliation 正交。三个 provider 的实现无需改动。

## 信号传递链路

```
1. SessionEventBridge.onEvent()                    // session-event-bridge.ts:49
   → controller.applySessionEvent({                // :51
       sessionId, status, summary,
       externalSessionId: event.payload.externalSessionId
     })

2. SessionRuntimeController.applySessionEvent()    // session-runtime-controller.ts:69
   → result = await manager.applySessionEvent(...)  // :70  — 捕获 { reconciled }
   → if (result.reconciled) console.info(...)       // 日志
   → pushSessionEvent(sessionId, status, summary)   // :76  — 内部读 snapshot 获取最新 externalId

3. pushSessionEvent()                               // :95
   → session = manager.snapshot().sessions.find()   // 读取最新 externalSessionId
   → win.send(IPC_CHANNELS.sessionEvent, {
       sessionId, status, summary,
       externalSessionId: session.externalSessionId  // 始终携带
     })

4. preload onSessionEvent                           // preload/index.ts:84
   → 透传到 renderer

5. App.vue handler                                  // App.vue:108
   → workspaceStore.updateSession(event.sessionId, {
       status: event.status,
       summary: event.summary,
       externalSessionId: event.externalSessionId   // 始终更新
     })

6. workspaces.ts updateSession                      // workspaces.ts:238
   → session.externalSessionId = patch.externalSessionId  // 已支持
   → syncSessionPresenceFromSummary(session)              // 重建 presence
```

**关键设计决策**: 不需要单独的 reconciliation IPC 通道。`SessionStatusEvent` 始终携带当前 `externalSessionId`，renderer 通过每条事件自动保持同步。

## Edge Cases

### E1. `--session-id` 是否生效

无论是否生效，reconciliation 逻辑均正确处理：
- 生效 → `session_id` = seeded UUID → 一致，no-op
- 不生效 → `session_id` ≠ seeded UUID → 首条事件触发首次 assignment 或对账

### E2. 用户 `/clear` 后立即退出

无 hook 事件触发 → reconciliation 不执行 → 存储的 `externalSessionId` 仍为旧值。

**Phase 2 兜底**: 注册 `SessionStart`（matcher: `clear`）和 `SessionEnd`（matcher: `clear`）hook。需用 `command` 类型 hook 包装 HTTP POST（`SessionStart` 不支持 `http` 类型）。

**实际影响**: 低频操作。正常路径中 `/clear` 后会继续输入 prompt → `UserPromptSubmit` → reconciliation 生效。

### E3. Codex `thread-id` 与 discovery ID 不一致

如果不一致，reconciliation 以 `thread-id` 为准（来自 turn-complete 事件，更可信）。

### E4. OpenCode `sessionID` 切换

> **FRAGILE**: 假设 `event.properties?.sessionID` 在 session 切换时变化，未确认。

### E5. 并发事件

**场景 A — 同 session 两个事件并发**（如 `UserPromptSubmit` + `Stop`）:
- 第一个更新 ID → 第二个 `previousId === externalSessionId` → no-op
- 幂等

**场景 B — discovery 与 sidecar 并发**:
- `discoverExternalSessionIdAfterStart`（`session-runtime.ts:119`）通过 `markSessionRunning` 设置 ID
- sidecar 事件通过 `applySessionEvent` 设置 ID
- 并发时两者都看到 `previousId === null` → 两次都是首次 assignment → 不产生虚假对账信号
- 后写入胜出，两个 ID 通常相同

**场景 C — 两个不同新 ID 并发**:
- 两个对账信号同时发射 → 后写入胜出
- Renderer 通过下一条 `SessionStatusEvent` 自动同步到最终值
- 短暂不一致可接受

### E6. 恶意/错误对账

无自动回滚。每次对账的 `previousExternalId` 可通过 `console.info` 日志追溯。

## Why Not Alternatives

| 方案 | 为什么不用 |
|------|-----------|
| 周期性 polling | 持续开销、延迟不可控 |
| PTY 输出解析 | 不可靠，需 regex ANSI 文本 |
| 文件系统 watch | 跨平台兼容性差 |
| 单独的 reconciliation IPC 通道 | 多余 — `SessionStatusEvent` 始终带 `externalSessionId` 即可 |
| `resolveSessionId()` 提取 | 与路由职责混淆，adapter 直接处理更清晰 |

## Migration Path

### 完整改动清单（8 个文件）

| # | 文件 | 改动 | Breaking? |
|---|------|------|-----------|
| 1 | `src/shared/project-session.ts` | `SessionStatusEvent` 增加 `externalSessionId: string \| null` | **YES** — 类型变更 |
| 2 | `src/core/project-session-manager.ts` | `applySessionEvent()` 增加对账逻辑，返回 `{ reconciled }` | **YES** — 返回类型变更 |
| 3 | `src/main/session-runtime-controller.ts` | `pushSessionEvent` 从 snapshot 读 externalId；`applySessionEvent` 捕获返回值 | **YES** — 行为变更 |
| 4 | `src/core/hook-event-adapter.ts` | 提取 `body.session_id` 为 `externalSessionId` | No — 增加字段 |
| 5 | `src/extensions/providers/codex-provider.ts` | notify 模板提取 `parsed['thread-id']` | No — 增加字段 |
| 6 | `src/renderer/app/App.vue` | `onSessionEvent` 传递 `event.externalSessionId` 到 store | **YES** — 必须传 |
| 7 | 测试文件（3 个） | mock 返回值、断言更新 | **YES** — 测试契约变更 |

### Phase 2: SessionStart/SessionEnd hook

注册 Claude Code 的 `SessionStart` 和 `SessionEnd` hook（`command` 类型），解决 E2 边界情况。

### Phase 3: `--session-id` 验证

确认 `claude --session-id <uuid>` 是否为公开 flag。如果不是，移除 seeding，完全依赖 hook 事件 discovery。

### Testing Strategy

| 场景 | 验证点 | 测试文件 |
|------|--------|---------|
| 首次 assignment（null → ID） | 设置 ID，`reconciled: false` | `project-session-manager.test.ts` |
| 对账检测（ID-A → ID-B） | 更新 ID，`reconciled: true` | `project-session-manager.test.ts` |
| 一致事件（ID → same ID） | 不变，`reconciled: false` | `project-session-manager.test.ts` |
| null/undefined 不覆写 | 保持当前值 | `project-session-manager.test.ts` |
| adapter 提取 `body.session_id` | 事件携带 `externalSessionId` | 相关 adapter 测试 |
| `pushSessionEvent` 包含 externalId | IPC payload 正确 | `session-runtime-controller.test.ts` |
| renderer store 更新 externalId | `updateSession` 接收 | `workspaces` store 测试 |
| discovery 与 sidecar 并发 | 无虚假对账信号 | `session-runtime-controller.test.ts` |

## Sources

- [Martin Fowler — Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Azure Architecture Center — Optimistic Concurrency](https://learn.microsoft.com/en-us/azure/architecture/patterns/optimistic-concurrency)
- [Claude Code Hooks Reference](https://docs.anthropic.com/en/docs/claude-code/hooks)

## Evidence Chain

| Claim | File | Location |
|-------|------|----------|
| Adapter reads 8 fields, ignores `session_id` | `src/core/hook-event-adapter.ts` | `:11-35` |
| Codex notify ignores `thread-id` | `src/extensions/providers/codex-provider.ts` | `:63-76` |
| OpenCode already extracts `sessionID` | `src/extensions/providers/opencode-provider.ts` | sidecar 模板 |
| `applySessionEvent` blind overwrites | `src/core/project-session-manager.ts` | `:313-315` |
| `SessionStatusEvent` lacks externalId | `src/shared/project-session.ts` | `:139-143` |
| Controller delegates + pushes IPC | `src/main/session-runtime-controller.ts` | `:69-79` |
| `pushSessionEvent` sends 3-field event | `src/main/session-runtime-controller.ts` | `:95-99` |
| `markSessionRunning` reads from snapshot | `src/main/session-runtime-controller.ts` | `:52-57` |
| `pushObservabilitySnapshots` reads from snapshot | `src/main/session-runtime-controller.ts` | `:117` |
| Preload transparent pass-through | `src/preload/index.ts` | `:84-88` |
| App.vue handler passes to store | `src/renderer/app/App.vue` | `:108-113` |
| `updateSession` accepts `externalSessionId` | `src/renderer/stores/workspaces.ts` | `:238-244` |
| Discovery path via `markSessionRunning` | `src/core/session-runtime.ts` | `:119-130` |
| Webhook routes by header, not body | `src/core/webhook-server.ts` | `:64` |
| `SessionSummary.externalSessionId` is `string \| null` | `src/shared/project-session.ts` | `:39` |
