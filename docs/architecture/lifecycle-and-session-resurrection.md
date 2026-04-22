# 生命周期与会话复活设计

## 目标

应用关闭、崩溃或重启后，系统应尽可能恢复到上一次的工作现场。恢复的重点不是重放所有终端历史，而是重新建立“工作区 -> CLI 会话 -> 状态视图”的映射关系，让 CLI 自己接管历史上下文恢复。

## 持久化最小模型

主进程在本地持久化的数据应尽量小，只保存恢复真正需要的字段。为避免路径或名称带来的歧义，工作区必须有稳定 `workspace_id`，并显式记录 `active_workspace_id`：

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

推荐默认路径为：`~/.stoa/state.json`。

## 恢复流程

1. 应用启动。
2. 主进程读取 `state.json`。
3. 过滤掉路径已不存在的工作区。
4. 对每个有效工作区重新创建 PTY 与 CLI 进程。
5. 根据对应 provider 能力决定是恢复 session 还是降级到 `needs_confirmation`。
6. 若 provider 支持恢复，则将 `last_cli_session_id` 作为参数传给 CLI。
7. 等待 CLI 和 hook sidecar 回传新的状态事件。
8. UI 基于 `active_workspace_id` 恢复激活工作区，但在 fresh event 到达前仍视为 provisional state。

## 运行态更新触发点

以下事件发生时应考虑刷新持久化数据：

- 新工作区创建。
- 收到新的真实 `last_cli_session_id`。
- 工作区状态发生关键变化，如运行中、已退出、错误。
- 用户重命名或移除工作区。

## 失败与降级

- `state.json` 缺失：按空状态启动。
- 某个工作区路径不存在：忽略该工作区，并在日志中记录。
- CLI 或 provider 无法恢复指定 session：保留工作区，但标记为 `needs_confirmation`。
- 状态文件损坏：尝试读取备份文件；若失败，启动空白状态并保留损坏文件供调试。

## 为什么不保存完整终端历史

当前阶段不把“完整滚动缓冲恢复”当作必须项，因为它会显著增加持久化复杂度和一致性成本。系统第一优先级是恢复会话指针与工作区结构，而不是把终端像录像一样完整回放。
