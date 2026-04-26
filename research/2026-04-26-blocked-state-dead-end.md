# Research: Blocked State Dead-End Analysis

**Date:** 2026-04-26
**Status:** Root cause confirmed
**Affected states:** `blocked` → `running`, `blocked` → `complete`

---

## Problem Statement

Session 的 `blocked` 状态无法正确转向 `running` 和 `complete`。一旦 session 进入 `blocked` 状态，它将永久停留在该状态，无法恢复。

---

## Session State Machine Overview

### 三层状态模型

Session 使用三层独立状态（定义于 `src/shared/project-session.ts`）:

| Layer | Type | States |
|-------|------|--------|
| Runtime | `SessionRuntimeState` | `created` → `starting` → `alive` → `exited` / `failed_to_start` |
| Agent | `SessionAgentState` | `unknown` / `idle` / `working` / `blocked` / `error` |
| UI Presence | `SessionPresencePhase` | `preparing` / `ready` / `running` / `complete` / `blocked` / `failed` / `exited` |

UI Presence 由 runtime + agent 状态通过 `derivePresencePhase()` 派生（`src/shared/session-state-reducer.ts:19-65`），按优先级:
1. `failed_to_start` / `exited+failed` / `error` → **failed**
2. `created` / `starting` → **preparing**
3. `agentState === 'blocked'` → **blocked**
4. `agentState === 'idle' && hasUnseenCompletion` → **complete**
5. `exited + clean` → **exited**
6. `agentState === 'working'` → **running**
7. `agentState === 'idle'` → **ready**

### 状态转换通过 Intent 驱动

Reducer（`reduceSessionState`）通过 14 种 intent 驱动状态转换（`src/shared/project-session-reducer.ts:67-155`）。

---

## Root Cause Analysis

### 事件流追踪

Claude Code 的 hook 事件通过 `adaptClaudeCodeHook()`（`src/core/hook-event-adapter.ts:4-47`）映射为 intent:

| Claude Code Hook Event | Mapped Intent | Agent State |
|------------------------|---------------|-------------|
| `UserPromptSubmit` | `agent.turn_started` | `working` |
| `PreToolUse` | `agent.tool_started` | `working` |
| `PermissionRequest` | `agent.permission_requested` | `blocked` |
| `Stop` | `agent.turn_completed` | `idle` + `hasUnseenCompletion=true` |
| `StopFailure` | `agent.turn_failed` | `error` |

### 死锁路径

以下是实际发生的事件序列:

```
Step 1: Claude Code → PermissionRequest hook
        → adaptClaudeCodeHook() → intent: agent.permission_requested
        → reducer line 132-135: agentState = 'blocked', blockingReason = 'permission'
        → UI Presence: blocked ✓ (correct)

Step 2: 用户授予权限 — Claude Code 无对应 hook 事件
        → 无 agent.permission_resolved intent 被发射

Step 3: Claude Code 继续 → PreToolUse hook
        → adaptClaudeCodeHook() → intent: agent.tool_started
        → sourceEventType = 'claude-code.PreToolUse'

Step 4: Reducer agent.tool_started 分支 (line 115-121):
        if (patch.sourceEventType === 'post_permission_continuation')  // FALSE - sourceEventType is 'claude-code.PreToolUse'
        else if (session.agentState !== 'blocked')                    // FALSE - agentState IS 'blocked'
        → 无任何变更, 状态保持 blocked

Step 5: Claude Code 完成 → Stop hook
        → intent: agent.turn_completed
        → Reducer line 123: session.agentState === 'unknown' || session.agentState === 'working'
        → 但 agentState 仍为 'blocked', 条件不满足
        → 无任何变更, 状态保持 blocked

→ Session 永久卡在 blocked 状态
```

### 核心问题

1. **`mapClaudeHookToPatch()` 没有 permission resolved 的映射** — Claude Code 在用户授权后不发射专门的 hook 事件，adapter 无法生成 `agent.permission_resolved` intent

2. **Reducer 对 `agent.tool_started` 的 blocked 守卫过于严格** — `session.agentState !== 'blocked'` 条件（line 118）在 permission granted 后的第一条 tool_started 事件时永远为 false，因为 Claude Code 的 sourceEventType 永远不是 `'post_permission_continuation'`

3. **`agent.turn_completed` 也被阻塞** — 其前置条件 `agentState === 'unknown' || 'working'`（line 123）在 blocked 状态下不满足，因此即使 turn 完成，hasUnseenCompletion 也无法被设置为 true，blocked → complete 路径同样死锁

### 对 Codex 的影响

Codex adapter（`mapCodexHookToPatch`, line 113-130）没有 `PermissionRequest` 映射，因此 Codex session 不进入 blocked 状态，不受此问题影响。

---

## Relevant Source Files

| File | Lines | Role |
|------|-------|------|
| `src/core/hook-event-adapter.ts` | 91-111 | `mapClaudeHookToPatch()` — hook → intent 映射，缺少 permission resolved |
| `src/shared/session-state-reducer.ts` | 115-121 | `agent.tool_started` reducer — blocked 守卫阻止转换 |
| `src/shared/session-state-reducer.ts` | 122-127 | `agent.turn_completed` reducer — 前置条件在 blocked 下不满足 |
| `src/shared/session-state-reducer.ts` | 137-141 | `agent.permission_resolved` reducer — 正确的转换逻辑，但从未被触发 |
| `src/shared/session-state-reducer.ts` | 183-191 | `markAgentWorkingIfRuntimeAlive()` — 只检查 runtimeState，不检查 agentState |
| `src/core/webhook-server.ts` | 118-120 | 验证: permission_resolved 的 agentState 不能为 blocked |
| `src/main/session-event-bridge.ts` | 110-127 | 事件桥接，将 CanonicalSessionEvent 转为 StatePatch |
