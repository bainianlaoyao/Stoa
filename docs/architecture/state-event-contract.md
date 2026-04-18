# 状态事件契约

## 目标

双通道模型能否真正成立，取决于状态通道是否有稳定、可验证、可演进的事件契约。本文件定义系统内唯一合法的状态事件封装格式。任何驱动 UI 状态、恢复逻辑或运行指标的字段，都必须来自本契约定义的结构化事件，而不是字符流推断。

## 基本原则

- 所有事件必须可版本化。
- 所有事件必须可去重。
- 所有事件必须能绑定到明确的工作区与 provider。
- 所有事件必须能在日志中被追踪。

## Canonical Event Envelope

```json
{
  "event_version": 1,
  "event_id": "evt_01HXYZ...",
  "event_type": "session.started",
  "timestamp": "2026-04-17T10:00:00.000Z",
  "workspace_id": "ws_demo_001",
  "provider_id": "opencode",
  "session_id": "chat-9f8a2b",
  "correlation_id": "tool_abc123",
  "source": "hook-sidecar",
  "payload": {}
}
```

## 字段定义

- `event_version`：事件协议版本号。用于后续兼容与迁移。
- `event_id`：全局唯一事件标识。Session Manager 以此做幂等去重。
- `event_type`：事件类别，采用点分命名法。
- `timestamp`：事件产生时间，使用 ISO 8601 UTC。
- `workspace_id`：稳定的工作区内部标识，不使用路径代替。
- `provider_id`：事件来源 provider，例如 `opencode`。
- `session_id`：CLI 内部会话指针；如果该事件尚未拿到真实 session，可为空，但后续必须补齐。
- `correlation_id`：用于串联同一次工具调用或同一段生命周期操作，可选但强烈建议提供。
- `source`：事件来源，例如 `hook-sidecar`、`provider-adapter`、`system-recovery`。
- `payload`：事件专属负载。

## 最小事件类型集合

当前阶段至少要求支持：

- `session.started`
- `session.resumed`
- `session.exited`
- `agent.thinking`
- `agent.awaiting_input`
- `tool.started`
- `tool.finished`
- `workspace.status_changed`
- `error.raised`
- `heartbeat.reported`

## 幂等与顺序规则

- Session Manager 必须把 `event_id` 视为幂等键。
- 系统不保证跨来源全局严格时序，但单个 `workspace_id + source` 序列内应尽量保持发送顺序。
- 如果乱序到达，Session Manager 应优先基于时间戳与当前状态机做合法性判断，而不是无条件覆盖。

## Workspace 绑定规则

任何会影响 UI、持久化或恢复流程的事件，必须带 `workspace_id`。仅有 `path` 或 `name` 的事件视为不合格事件，不能直接驱动主状态。

## 安全与信任边界

- Webhook 服务只监听 loopback 地址。
- 每个工作区在运行时生成独立 secret，用于 sidecar 上报时认证。
- 缺失 secret 或 `workspace_id` 不匹配的事件必须被拒绝并写日志。

## 启动阶段特殊规则

应用刚启动、尚未收到 fresh event 时，UI 中展示的工作区状态只视为 provisional state。只有收到当前轮真实状态事件后，卡片灯、状态摘要和会话信息才进入 authoritative state。
