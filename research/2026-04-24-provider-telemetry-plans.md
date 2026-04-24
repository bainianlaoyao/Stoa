---
date: 2026-04-24
topic: minimal-invasive telemetry plans for codex, claude-code, opencode
status: completed
mode: context-gathering
sources: 12
---

## Provider Telemetry Plans: Task Completion & Input Request Capture

### Why This Was Gathered
Design the least invasive, most elegant telemetry plan for each non-shell provider to capture:
1. **Task completion** — agent finishes a response/turn
2. **Input request** — agent needs user input (permission, clarification, tool confirmation)

Current pipeline: `webhook-server.ts` → `session-event-bridge.ts` → `session-runtime-controller.ts` → IPC → renderer. All three plans should feed into this existing pipeline with minimal changes.

---

## Plan A: Claude Code — HTTP Hooks → Webhook Server

### Core Idea
Claude Code 内置了 30 种 hook event types，其中 `http` 类型的 hook 可以直接 POST 到我们的 webhook server。**零代码侵入，纯配置驱动。**

### Key Hooks for Our Use Case

| Hook Event | 捕获什么 | Payload 关键字段 |
|---|---|---|
| `Stop` | **任务完成** — Claude 结束当前回合 | `session_id`, `transcript_path`, `stop_reason` |
| `Notification` | **通知事件** — Claude 发送通知 | `session_id`, `notification message` |
| `PermissionRequest` | **要求输入（权限）** | `session_id`, `tool_name`, `tool_input` |
| `PreToolUse` | 工具调用前（可用于细粒度追踪） | `session_id`, `tool_name`, `tool_input` |
| `SessionStart` | 会话开始 | `session_id` |

### Implementation

**Step 1**: Claude Code 启动时，动态生成 hooks 配置写入 `.claude/settings.local.json`

```jsonc
// .claude/settings.local.json (auto-generated, gitignored)
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:${WEBHOOK_PORT}/events",
            "timeout": 5
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:${WEBHOOK_PORT}/events",
            "timeout": 5
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:${WEBHOOK_PORT}/events",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:${WEBHOOK_PORT}/events",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

**Step 2**: HTTP hook 自动以 POST 发送 JSON payload，包含 `hook_event_name` 字段。在 `webhook-server.ts` 中新增一个路径（或复用 `/events`）接收 hook payloads 并转换为 `CanonicalSessionEvent`：

```
Claude hook payload (stdin JSON as HTTP body):
{
  "session_id": "abc-123",
  "hook_event_name": "Stop",
  "transcript_path": "...",
  "cwd": "...",
  "permission_mode": "default"
}
         ↓ translate
CanonicalSessionEvent:
{
  event_version: 1,
  event_id: "<uuid>",
  event_type: "hook.Stop",
  timestamp: "<ISO>",
  session_id: "<mapped>",
  project_id: "<mapped>",
  source: "hook-sidecar",
  payload: {
    status: "awaiting_input",  // Stop → awaiting_input
    summary: "task_complete"
  }
}
```

**Step 3**: 映射规则

| Claude Hook | → SessionStatus | 含义 |
|---|---|---|
| `SessionStart` | `starting` | 会话启动 |
| `Stop` (stop_reason: "end_turn") | `awaiting_input` | 任务完成，等待用户输入 |
| `Stop` (stop_reason: "tool_deferred") | `needs_confirmation` | 等待权限确认 |
| `PermissionRequest` | `needs_confirmation` | 需要用户授权 |
| `Notification` | 保持当前 status | 通知类事件 |

### 优势
- **零代码修改 Claude Code 本身** — 只写一个 settings.local.json
- **HTTP hook 是官方支持的集成方式** — 不依赖 stdout 解析，不怕输出格式变化
- **实时推送** — 不需要轮询
- **支持交互式会话** — 不仅限于 `-p` (headless) 模式

### 风险
- Claude Code 的 HTTP hook 可能在某些版本中行为有差异
- `settings.local.json` 需要在每次会话启动前写入，需要清理机制
- 需要在 `webhook-server.ts` 中新增 hook payload → CanonicalEvent 的转换层

### 当前代码改动点
1. `claude-code-provider.ts` — 新增 `installSidecar()` 方法，写入 hooks 配置
2. `webhook-server.ts` — 新增 `/hooks` 端点或扩展 `/events` 以接受 Claude hook 格式
3. `session-event-bridge.ts` — 新增 hook event → status 的映射逻辑

---

## Plan B: Codex — `notify` Callback + JSONL Stdout Parsing

### Core Idea
Codex 提供两个零侵入的事件源：
1. `notify` 配置 — 回调 `agent-turn-complete` 事件
2. `codex exec --json` — JSONL 流输出完整的 turn lifecycle

### Option B1: `notify` Callback（推荐用于交互式会话）

**原理**: Codex 的 `config.toml` 支持 `notify` 字段，指定一个外部程序，当 `agent-turn-complete` 时调用。

**Step 1**: 启动时动态生成一个通知脚本：

```python
#!/usr/bin/env python3
# .codex/notify-stoa.py (auto-generated)
import json, sys, urllib.request

notification = json.loads(sys.argv[1])
port = ${WEBHOOK_PORT}
secret = "${SESSION_SECRET}"

event = {
    "event_version": 1,
    "event_id": notification.get("turn-id", ""),
    "event_type": "codex.agent-turn-complete",
    "timestamp": "",
    "session_id": "${SESSION_ID}",
    "project_id": "${PROJECT_ID}",
    "source": "provider-adapter",
    "payload": {
        "status": "awaiting_input",
        "summary": notification.get("last-assistant-message", "")[:200],
        "isProvisional": False
    }
}

req = urllib.request.Request(
    f"http://127.0.0.1:{port}/events",
    data=json.dumps(event).encode(),
    headers={"content-type": "application/json", "x-stoa-secret": secret},
    method="POST"
)
try:
    urllib.request.urlopen(req, timeout=3)
except Exception:
    pass
```

**Step 2**: 在 Codex 的 `config.toml` 中配置：

```toml
notify = ["python3", ".codex/notify-stoa.py"]
```

**notify payload 字段**:

| Field | Description |
|---|---|
| `type` | `"agent-turn-complete"` |
| `thread-id` | Session ID |
| `turn-id` | Turn ID |
| `last-assistant-message` | Agent 最后一条消息文本 |
| `input-messages` | 用户输入消息列表 |

### Option B2: JSONL Stdout Parsing（推荐用于 headless/exec 模式）

当用 `codex exec --json` 启动时，stdout 输出标准 JSONL：

```jsonl
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_1","type":"command_execution",...}}
{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{"input_tokens":24763,"output_tokens":122}}
```

**映射规则**:

| JSONL Event | → SessionStatus | 含义 |
|---|---|---|
| `thread.started` | `starting` | 会话开始 |
| `turn.started` | `running` | 新回合开始 |
| `item.completed` (type=agent_message) | `running` | 消息输出（中间态） |
| `turn.completed` | `awaiting_input` | **任务完成**，等待用户 |
| `turn.failed` | `error` | 回合失败 |

### 优势
- **`notify` 是官方支持的回调机制** — 不需要解析输出
- **JSONL 是结构化格式** — 不怕格式漂移
- **两种模式互补** — 交互式用 notify，headless 用 JSONL
- **不需要修改 Codex 源码**

### 风险
- **Hooks 在 Windows 上目前被禁用** — 所以我们不用 hooks，改用 notify + JSONL
- `notify` 目前只支持 `agent-turn-complete` 一个事件类型 — 无法细粒度追踪中间态
- JSONL 只在 `exec` 模式可用，交互式 TUI 模式没有结构化输出
- Python 依赖 — notify 脚本需要 python3（可替换为 Node.js 脚本）

### 当前代码改动点
1. `codex-provider.ts` — 新增 `installSidecar()` 写入 notify 脚本和 config.toml
2. `codex-provider.ts` — 如果用 exec 模式，需新增 JSONL stdout parser
3. `webhook-server.ts` — 复用现有 `/events` 端点（notify 脚本直接发 CanonicalSessionEvent）

---

## Plan C: OpenCode — Enhanced Plugin (扩展现有 sidecar)

### Core Idea
OpenCode 已有 sidecar plugin（`.opencode/plugins/stoa-status.ts`），当前只监听 `session.idle`。OpenCode 提供 26 种事件类型，扩展 plugin 即可覆盖所有需求。**改动最小，最自然。**

### OpenCode 可用事件（与埋点相关的）

| Event | 捕获什么 |
|---|---|
| `session.idle` | **要求输入** — agent 空闲等待（已有） |
| `message.updated` | **消息更新** — 可检测 assistant 消息完成 |
| `tool.execute.after` | **工具执行完成** — 可追踪任务进度 |
| `permission.asked` | **权限请求** — 需要用户授权 |
| `permission.replied` | **权限回复** — 用户已回应 |
| `session.error` | **会话错误** |

### Enhanced Plugin Design

当前 plugin（`opencode-provider.ts:31-41`）只做了一件事：

```typescript
status: event.type === 'session.idle' ? 'awaiting_input' : 'running',
```

扩展后：

```typescript
export const StoaStatusPlugin = async () => ({
  event: async ({ event }) => {
    // --- 任务完成检测 ---
    // session.idle = agent 完成当前任务，等待用户
    // message.updated (agent message) = 中间输出，可做细粒度追踪

    let status = 'running'
    let summary = event.type
    let isProvisional = false

    switch (event.type) {
      case 'session.idle':
        status = 'awaiting_input'
        summary = 'task_complete'
        break
      case 'permission.asked':
        status = 'needs_confirmation'
        summary = 'permission_request'
        break
      case 'session.error':
        status = 'error'
        summary = 'session_error'
        break
      case 'message.updated':
        // 可选：提取最后一条 assistant 消息作为 summary
        // 但不改变 status，保持 running
        isProvisional = true
        break
    }

    await fetch('http://127.0.0.1:${WEBHOOK_PORT}/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-stoa-secret': '${SESSION_SECRET}'
      },
      body: JSON.stringify({
        event_version: 1,
        event_id: event.id ?? crypto.randomUUID(),
        event_type: `opencode.${event.type}`,
        timestamp: new Date().toISOString(),
        session_id: '${SESSION_ID}',
        project_id: '${PROJECT_ID}',
        correlation_id: event.properties?.messageID ?? undefined,
        source: 'hook-sidecar',
        payload: {
          status,
          summary,
          isProvisional,
          externalSessionId: event.properties?.sessionID ?? undefined
        }
      })
    })
  }
})
```

### 映射规则

| OpenCode Event | → SessionStatus | 含义 |
|---|---|---|
| `session.idle` | `awaiting_input` | **任务完成** + **等待输入** |
| `permission.asked` | `needs_confirmation` | 需要用户授权 |
| `permission.replied` | `running` | 用户已回应，继续执行 |
| `session.error` | `error` | 会话错误 |
| `message.updated` | `running` (isProvisional) | 中间消息，可选追踪 |
| `tool.execute.after` | `running` | 工具执行完成 |

### 优势
- **已有 sidecar plugin 基础** — 只需扩展 switch-case
- **OpenCode plugin 系统最丰富** — 26 种事件，细粒度最高
- **零外部依赖** — 不需要 Python/Node 脚本，plugin 直接在 OpenCode 进程内运行
- **SDK + SSE 备选** — 如果未来需要更丰富的集成，可用 `@opencode-ai/sdk` 的 SSE 流

### 风险
- `session.idle` 同时承担了"任务完成"和"等待输入"两个语义 — 无法区分"我做完了一个子任务但还有更多"和"我做完了等你说话"
- OpenCode plugin 系统在快速迭代中，event type 可能变化
- `message.updated` 可能高频触发，需要注意节流

### 当前代码改动点
1. `opencode-provider.ts:31-41` — 扩展 `writeSidecarPlugin()` 中的 plugin 模板，增加更多 event type 的处理
2. **不需要改动 webhook-server 或 bridge** — 因为已经能处理 CanonicalSessionEvent

---

## Comparative Summary

| 维度 | Claude Code (Plan A) | Codex (Plan B) | OpenCode (Plan C) |
|---|---|---|---|
| **侵入性** | 极低 — 写 settings.local.json | 低 — 写 notify 脚本 | 最低 — 扩展现有 plugin |
| **改动文件** | claude-code-provider + webhook-server | codex-provider + notify 脚本 | opencode-provider (仅此一个) |
| **任务完成** | `Stop` hook | `agent-turn-complete` / `turn.completed` | `session.idle` |
| **要求输入** | `PermissionRequest` hook | 暂无细粒度支持 | `permission.asked` |
| **实时性** | HTTP POST 即时 | notify 即时 / JSONL 流式 | plugin 内 fetch 即时 |
| **Windows 兼容** | ✅ hooks 基于 HTTP，无限制 | ⚠️ hooks 不可用，notify 可用 | ✅ plugin 系统无限制 |
| **稳定性风险** | 低 — 官方 HTTP hooks API | 中 — notify 只支持 1 种事件 | 低 — 官方 plugin API |
| **细粒度** | 高 — 30 种 hook events | 中 — 只有 turn 级别 | 高 — 26 种 event types |

---

## Recommended Implementation Order

1. **OpenCode (Plan C)** — 改动最小，扩展现有 plugin 即可，立即可做
2. **Claude Code (Plan A)** — HTTP hooks 方案优雅，但需要新增 hook payload 转换层
3. **Codex (Plan B)** — notify 方案简单但覆盖有限，JSONL 方案需要改启动模式

### Evidence Chain

| Finding | Source |
|---|---|
| Claude Code 30 hook event types, HTTP handler | [Hooks Reference](https://code.claude.com/docs/en/hooks) |
| Claude Code stream-json output format | [Headless Mode](https://code.claude.com/docs/en/headless) |
| Codex hooks (experimental, no Windows) | [Codex Hooks](https://developers.openai.com/codex/hooks) |
| Codex `notify` callback, `agent-turn-complete` | [Codex Advanced Config](https://developers.openai.com/codex/config-advanced) |
| Codex `exec --json` JSONL event types | [Codex Non-interactive](https://developers.openai.com/codex/noninteractive) |
| OpenCode 26 event types, plugin API | [OpenCode Plugins](https://opencode.ai/docs/plugins/) |
| OpenCode SDK SSE event streaming | [OpenCode SDK](https://opencode.ai/docs/sdk/) |
| OpenCode server HTTP API | [OpenCode Server](https://opencode.ai/docs/server/) |
