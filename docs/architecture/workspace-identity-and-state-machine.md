# Workspace 身份与状态机契约

## 为什么需要单独定义

如果工作区只靠路径或名称识别，那么重命名、路径变更、别名冲突、UI 列表重建时都会出现歧义。与此同时，状态灯、恢复流程和错误处理也需要统一状态机，否则不同模块会各自发明自己的状态词汇。

## Workspace Identity

每个工作区必须拥有一个稳定的 `workspace_id`。建议使用创建时生成的 UUID 或受控短 ID，而不是路径哈希。

### 持久化字段

推荐最小模型扩展为：

```json
{
  "version": 1,
  "active_workspace_id": "ws_demo_001",
  "workspaces": [
    {
      "workspace_id": "ws_demo_001",
      "path": "D:/projects/demo",
      "name": "demo",
      "provider_id": "opencode",
      "last_cli_session_id": "chat-9f8a2b",
      "last_known_status": "running",
      "updated_at": "2026-04-17T10:00:00.000Z"
    }
  ]
}
```

### 规则

- `workspace_id` 一经创建，不因路径或名称变化而变化。
- `path` 可变，但变更时必须更新持久化记录。
- `name` 是展示字段，不得作为系统唯一键。
- `active_workspace_id` 由主进程持久化，渲染层只消费，不自行发明默认规则。

## Workspace 状态机

当前阶段统一采用以下状态：

- `bootstrapping`
- `starting`
- `running`
- `awaiting_input`
- `degraded`
- `error`
- `exited`
- `needs_confirmation`

## 合法状态迁移

```text
bootstrapping -> starting
starting -> running
running -> awaiting_input
awaiting_input -> running
running -> degraded
awaiting_input -> degraded
degraded -> running
degraded -> error
running -> exited
awaiting_input -> exited
error -> starting
exited -> starting
starting -> error
bootstrapping -> needs_confirmation
starting -> needs_confirmation
```

## 状态语义

- `bootstrapping`：应用启动后、工作区已从持久化加载但尚未完成恢复。
- `starting`：正在启动 PTY、CLI 或恢复会话。
- `running`：会话活跃，Agent 或终端正在正常运行。
- `awaiting_input`：会话仍存活，但正在等待用户输入或下一步操作。
- `degraded`：视觉流和状态流至少有一条失效，但工作区可能仍部分可用。
- `error`：发生明确错误，需要重试或人工干预。
- `exited`：工作区进程已退出。
- `needs_confirmation`：恢复信息不足或 provider 无法可靠恢复，需用户确认后继续。

## 启动时 UI 约定

应用启动后，卡片状态可先显示 `bootstrapping` 或上次记录的 `last_known_status`，但必须明确这是 provisional state。只有当前轮真实事件到达后，状态才视为 authoritative。
