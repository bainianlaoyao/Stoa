# Provider 能力契约

## 目标

系统依赖不同 CLI provider 提供会话启动、session 指针提取、sidecar 注入和恢复参数拼装能力。如果不定义统一能力边界，恢复流程和状态通道都会变成 provider-specific 特判地狱。

## Provider 最低接口

每个 provider 至少需要定义以下能力：

- `buildStartCommand(workspace)`：生成启动命令与参数。
- `buildResumeCommand(workspace, sessionId)`：生成恢复命令与参数；如果不支持恢复，必须显式声明。
- `resolveSessionId(event)`：从结构化事件中提取真实 CLI session id。
- `installSidecar(workspace)`：在需要时向工作区注入 sidecar。
- `supportsResume()`：返回是否支持可靠恢复。
- `supportsStructuredEvents()`：返回是否支持可靠状态事件回传。

## 能力分级

### Level 0：No Resume

- 可以启动 CLI。
- 不能可靠恢复历史会话。
- 系统必须在应用重启后将工作区标记为 `needs_confirmation`。

### Level 1：Resume Only

- 支持恢复 CLI 历史会话。
- 但结构化事件能力不足或不稳定。
- 系统可恢复工作区，但状态灯可能降级为 `degraded`。

### Level 2：Full Contract

- 支持恢复会话。
- 支持可靠结构化事件回传。
- 支持 session id 提取与 sidecar 注入。
- 可完整参与双通道模型。

## 失败回退规则

- `supportsResume() === false`：禁止伪造恢复成功，必须降级到 `needs_confirmation`。
- `supportsStructuredEvents() === false`：允许保留视觉流，但状态灯必须显式降级，不得伪装成正常运行。
- provider 初始化失败：工作区进入 `error`，并记录 provider id 与失败原因。

## 为什么必须写成契约

白皮书的核心承诺之一是“GUI 不猜测 CLI 状态”。如果 provider 无法提供可靠 session 指针或结构化事件，系统就必须诚实降级，而不是用终端输出继续猜。这个契约是防止架构腐化的关键边界。
