# Hermes 全局 Agent 设计

日期：2026-05-07

## 背景

Stoa 当前已经具备多项目、多 provider、多 session 的本地编排基础，但“全局认知调度”仍然缺位。

现有系统能稳定提供：

- 主进程集中维护的 session / project 状态
- 基于结构化 side-channel 的 observability
- provider 驱动的 session recovery
- 本地终端托管与切换

但它仍然缺少一个跨 session、跨项目、跨窗口的全局控制面，用来完成以下工作：

- 把多个 session 的状态收束成全局摘要
- 把局部 agent 的输出变成可审查、可批准、可追踪的 proposal
- 给全局 agent 提供结构化数据访问与会话控制接口
- 降低并行 session 带来的 review debt、context switching 和全局冲突

本方案定义：

**Hermes = Stoa 的全局认知调度 agent。**

它不是普通聊天助手，也不是项目树里的另一个 coding session；它是一个独立的系统工作面，以及一组由 Stoa 托管的全局 agent sessions。

这是 breaking change。原型阶段不做兼容迁移。

## 目标

- 新增独立的 `Hermes surface`，与现有 `command` 页并列
- 支持多个并行 `Hermes sessions`
- 每个 Hermes session 都是一个真实的 provider-managed session，运行 Hermes agent 自带 TUI
- Hermes agent 通过本地 CLI `stoa-ctl` 用 shell 直接调用 Stoa 能力，不走 MCP
- `stoa-ctl` 必须支持：
  - 读取全局状态
  - 读取任意 work session 的结构化上下文
  - 读取任意 work session 的 `full` 人类可读纯文本上下文
  - 向任意 work session 注入 prompt
  - 创建 / 查询 / 等待 proposal
  - 执行受控 dispatch
- 所有高风险动作都经过 proposal / approval / stale-check
- Hermes session 的恢复机制必须与其他 provider 同类：依赖 provider 自身 resume 方案，而不是 Stoa 私有恢复协议

## 非目标

- 不把 Hermes 变成普通项目树里的 session
- 不让 renderer 自己拼 session full context
- 不把 `context full` 伪装成 provider 内部完整上下文镜像
- 不让 Hermes 直接旁路 session 输入链路
- 不在 v1 做自动多步 workflow DSL
- 不在 v1 做离线模式或 Stoa 未运行时的 CLI 能力
- 不在 v1 为旧 API / 旧命令做兼容层

## 术语

### Work Session

Stoa 当前项目树中的普通 provider-managed session，例如 `claude-code`、`codex`、`opencode`、`shell`。

### Hermes Session

Hermes surface 左栏里的内部全局 agent session。

它在产品语义上不属于任何项目树，但在运行时语义上是一个 provider-managed session，拥有自己的 resume pointer、状态、终端和 TUI。

### Inspector Target

Hermes surface 右栏当前聚焦的对象。v1 允许三类：

- `app`
- `work-session`
- `proposal`

### Proposal

Hermes 发起的高风险或需审批动作对象。proposal 是系统控制意图，不是普通聊天文本。

## 产品定位

Hermes 的第一原则是：

**reduce context switching, not replace judgment**

它的作用是降低全局切换成本和并行失控风险，而不是替代用户的最终判断。

因此，Hermes v1 的能力重点是：

- 全局摘要
- session 上下文读取
- 可审查动作生成
- 可批准动作执行

而不是全自动项目经理。

## 核心架构

Hermes 的整体形态是：

```text
Hermes Agent TUI (provider-managed session)
  -> shell
  -> stoa-ctl
  -> loopback HTTP control API
  -> Stoa main process
  -> session / observability / evidence / dispatcher
```

架构分成四层：

### 1. Hermes Provider 层

Hermes agent 必须作为新的 provider 类型接入，和现有 `claude-code` / `codex` / `opencode` 属于同级概念。

要求：

- 有自己的启动命令
- 有自己的 structured event / session pointer / resume 机制
- 有自己的 provider adapter
- 恢复时优先走 `resume session`，而不是 Stoa 注入自定义恢复逻辑

### 2. Hermes Surface 层

新增独立顶层 `surface = hermes`。

它不复用项目树布局，也不把 Hermes session 混入 command surface。

### 3. Hermes Control Plane 层

新增主进程控制 API，供 `stoa-ctl` 使用。

控制面必须：

- 只监听 loopback
- 与 provider ingress 路由分离
- 使用独立 control token
- 通过统一 dispatcher 触发副作用动作

### 4. 事实源层

Hermes 不直接读 renderer UI 状态，而是消费 Stoa 主进程已有的事实源：

- `ProjectSessionManager`
- observability snapshots
- observation events
- session evidence
- runtime jobs
- terminal replay / backlog

## Hermes Surface 设计

Hermes surface 采用三栏布局。

### 左栏：Hermes Session List

左栏只展示 Hermes sessions，不展示 work sessions，不展示项目树。

它是扁平列表，不做按项目分组。

每项至少显示：

- `title`
- `status`
- `updatedAt`
- `pendingProposalCount`
- `activeTargetCount`
- `lastSummary`

左栏的最小动作集：

- 创建 Hermes session
- 选择 Hermes session
- 关闭 Hermes session

### 中栏：Hermes TUI

中栏承载当前选中 Hermes session 的真实终端。

要求：

- 复用现有 terminal viewport / PTY / replay 能力
- 切换 Hermes session 时保持后台 runtime 存活
- Hermes agent 在其中通过 shell 调用 `stoa-ctl`

中栏不承担结构化审批职责，不叠加复杂辅助控件。

### 右栏：Stoa Native Inspector

右栏是事实与控制面，不是聊天面。

默认分三块：

- `Global Brief`
- `Target Inspector`
- `Action Panel`

右栏展示的是 Stoa 原生结构化状态，而不是 Hermes 自己自然语言总结的副本。

右栏的最小动作集：

- 批准 proposal
- 拒绝 proposal
- 批准并执行 proposal
- 执行低风险 preset actions

## Hermes Session 模型

Hermes session 是全局共享型，不绑定单一项目。

即：

- 一个 Hermes session 可以读取所有项目和所有 work sessions
- 它的讨论主题可以不同，但读取 scope 默认是全局的
- v1 不做严格项目隔离或项目主绑定

Hermes session 需要最少元数据：

```ts
interface HermesSessionSummary {
  id: string
  title: string
  status: 'created' | 'starting' | 'running' | 'waiting_approval' | 'idle' | 'failed' | 'closed'
  capabilityLevel: 0 | 1 | 2 | 3
  pendingProposalCount: number
  activeTargetCount: number
  lastSummary: string
  lastRisk: string | null
  resumeSessionId: string | null
  createdAt: string
  updatedAt: string
  lastActivatedAt: string | null
}
```

注意：

- `resumeSessionId` 来自 Hermes provider 自身能力
- 不是 Stoa 自定义虚构的恢复指针

## CLI 设计

Hermes agent 的主要系统接口是：

**`stoa-ctl`**

它是独立命令，不是 `stoa ctl` 子命令。

### CLI 定位

- 第一使用者是 Hermes agent 本身
- Hermes agent 通过 shell 直接调用它
- 它是 machine-first local control tool
- Stoa 未运行时默认失败

### 传输方式

`stoa-ctl` 通过 loopback HTTP 调用 Stoa 主进程控制面。

推荐环境变量：

- `STOA_CTL_BASE_URL`
- `STOA_CTL_TOKEN`
- `STOA_HERMES_SESSION_ID`

### Route 命名空间

控制面统一使用 `/ctl/*`，与 provider ingress 分离。

示例：

- `/ctl/health`
- `/ctl/state/*`
- `/ctl/work-sessions/*`
- `/ctl/hermes-sessions/*`
- `/ctl/proposals/*`
- `/ctl/dispatch/*`

### CLI 功能域

v1 功能面分成 6 组：

#### `health`

- `stoa-ctl health`
- `stoa-ctl whoami`
- `stoa-ctl capabilities`

#### `state`

- `stoa-ctl state brief`
- `stoa-ctl state attention-queue`
- `stoa-ctl state conflicts`

#### `work-sessions`

- `stoa-ctl work-sessions list`
- `stoa-ctl work-sessions get <sessionId>`
- `stoa-ctl work-sessions events <sessionId>`
- `stoa-ctl work-sessions context <sessionId> --level status`
- `stoa-ctl work-sessions context <sessionId> --level bundle`
- `stoa-ctl work-sessions context <sessionId> --level full`
- `stoa-ctl work-sessions prompt <sessionId> --text "..."`
- `stoa-ctl work-sessions prompt <sessionId> --file prompt.md`
- `stoa-ctl work-sessions prompt <sessionId> --stdin`

#### `hermes-sessions`

- `stoa-ctl hermes-sessions list`
- `stoa-ctl hermes-sessions create --title "global-triage"`
- `stoa-ctl hermes-sessions get <hermesSessionId>`
- `stoa-ctl hermes-sessions close <hermesSessionId>`
- `stoa-ctl hermes-sessions activate <hermesSessionId>`

#### `proposals`

- `stoa-ctl proposals list`
- `stoa-ctl proposals get <proposalId>`
- `stoa-ctl proposals create ...`
- `stoa-ctl proposals wait <proposalId>`

#### `dispatch`

- `stoa-ctl dispatch preset <name> --target <sessionId>`
- `stoa-ctl dispatch proposal <proposalId>`

## Context 能力分层

`context` 不是单一返回值，而是分层 contract。

### `status`

最小结构化状态层。适合快速 triage。

### `bundle`

结构化上下文包。适合程序检索与右栏 inspector。

至少包括：

- session 元数据
- presence / observability
- recent events
- evidence refs
- runtime jobs
- safe actions
- gated actions
- unknowns

### `full`

这是正式承诺能力：

**Stoa 保证提供某个 work session 已被 Stoa 观测、保存、可恢复的全部人类可读文本上下文。**

要求：

- 默认直接输出大段纯文本
- 可以并入 terminal replay 中的人类可读文本
- 允许轻量段落标记，如 `[User]`、`[Assistant]`、`[Terminal]`
- 不输出大 JSON 包装

不包含：

- tool calling 细节
- tool result 原始结构化载荷
- hidden reasoning
- provider 内部未暴露上下文
- 二进制内容与纯控制序列

## CLI 输出 Contract

### 总体规则

- `stdout` 是正式机器接口
- `stderr` 只放诊断信息
- 除 `context --level full` 外，其它命令默认输出 `json`
- `context --level full` 默认输出纯文本

### JSON Envelope

建议统一为：

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

失败时：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "approval_required",
    "message": "Prompt injection requires approval.",
    "details": {}
  }
}
```

### Full Context 分片

大文本允许分页：

- `--max-chars <n>`
- `--cursor <token>`

如需结构化拿 full context，可额外指定：

- `--format json`

### 退出码

- `0` 成功
- `2` 参数错误
- `3` 认证失败 / 无法连接运行中的 Stoa
- `4` 需要人工批准
- `5` 目标状态过期或冲突
- `6` 目标不存在
- `7` 服务器内部错误

## Proposal 与审批模型

### 动作分级

#### Read

纯读取。不产生 proposal。

#### Direct Action

低风险可直接执行，但必须记 action log。

例如：

- `run-tests-only`
- `summarize-failures`
- `pause-and-generate-summary`

#### Gated Action

需要人工判断的动作，必须先 proposal。

例如：

- 自由文本 prompt 注入
- 可能驱动代码修改的 prompt
- 跨多个 session 的联动调度

### Prompt 注入规则

必须支持对任意 work session prompt 输入。

但分级如下：

- `preset prompt`：可视为低风险 direct action
- `freeform prompt`：默认视为 `Level 3`，必须 proposal + approval

### Proposal 对象

```ts
interface HermesProposal {
  id: string
  hermesSessionId: string
  kind: 'prompt' | 'preset' | 'sync' | 'pause' | 'dispatch'
  targetSessionIds: string[]
  riskLevel: 0 | 1 | 2 | 3
  status: 'pending_approval' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'stale'
  summary: string
  reason: string
  promptText: string | null
  presetName: string | null
  snapshot: {
    sessions: Array<{
      sessionId: string
      lastStateSequence: number
      turnEpoch: number
      updatedAt: string
    }>
  }
  createdAt: string
  updatedAt: string
  approvedAt: string | null
  rejectedAt: string | null
  executedAt: string | null
  executionResult: string | null
}
```

### 审批入口

审批由右栏原生控制面完成，不通过 Hermes TUI 文本确认。

v1 支持：

- `Approve`
- `Reject`
- `Approve and Execute`

`Edit prompt` 不进 v1。

### Stale-check

批准或执行前必须比较 proposal snapshot 与目标 session 当前关键状态。

若关键状态已变：

- proposal 状态转为 `stale`
- Hermes 需重新读取上下文并生成新 proposal

## 动作执行模型

所有有副作用的动作统一走：

`Hermes agent -> stoa-ctl -> Control API -> HermesCommandDispatcher -> work session`

要求：

- UI 不直接改目标 session
- route handler 不直接旁路输入链路
- 所有动作统一 capability check、approval check、stale-check、action log

## 持久化与恢复

### Hermes Session 恢复原则

Hermes session 的恢复机制与其他 provider 完全同类。

要求：

- Hermes provider 自己提供 session pointer / resume 能力
- Stoa 只保存 pointer 并在下次启动时发起 resume
- 不使用 Stoa 私有“重建 Hermes runtime”协议替代 provider resume

### 恢复顺序

1. 恢复普通 project/work session 基础状态
2. 恢复 observability / evidence / pointers
3. 恢复 Hermes state
4. 对可恢复 Hermes sessions 发起 provider resume

Hermes 是否读取全局事实，由其在会话中主动调用 `stoa-ctl` 决定，不由 Stoa 启动时强制注入。

### 持久化对象

Hermes 独立状态与现有项目/session 恢复索引分离，建议单独文件持久化。

至少保存：

- Hermes sessions
- active Hermes session id
- proposals
- action logs
- inspector target

不把大量 TUI backlog 或全局事实快照塞进主状态文件。

## 后端模块边界

建议新增：

- `HermesManager`
- `HermesControlServer`
- `HermesProposalStore`
- `HermesCommandDispatcher`
- `HermesContextAssembler`

并保持：

- `ProjectSessionManager` 继续只管普通 project/work session
- `SessionEventBridge` 继续只管 provider ingress / evidence / observability
- Hermes 新能力通过新增模块消费现有事实源，而不是污染已有核心状态模型

## UI 设计约束

Hermes surface 仍然受全局设计语言约束：

- 使用共享 design tokens
- 保持 Modern Minimalist Glassmorphism + Clean UI
- 不引入与现有控制台冲突的重框线、多面板 IDE 风格
- 中栏终端继续使用 monospace
- 右栏结构化面板保持轻量层次与低噪声

## 测试策略

### 单元测试

- Hermes proposal 状态机
- capability / approval / stale-check
- context `status / bundle / full` 组装规则
- full context 纯文本合并与分页
- prompt 注入权限分级

### 主进程 / 控制面测试

- `/ctl/*` 路由鉴权
- `stoa-ctl` 命令与错误码
- Hermes provider resume 指针保存与恢复
- proposal 批准后统一走 dispatcher

### Renderer / 组件测试

- 新 `hermes` surface 切换
- 左栏 Hermes session 列表
- 中栏 Hermes terminal deck 保活切换
- 右栏 brief / inspector / action panel

### E2E

- 创建 Hermes session
- Hermes surface 切换与后台保活
- Hermes agent 通过 `stoa-ctl` 读取某个 work session `context --level full`
- Hermes agent 创建 prompt proposal，右栏批准后成功投递到目标 work session
- Stoa 重启后 Hermes session 通过 provider resume 恢复

### 质量门禁

实现完成后必须通过当前仓库完整质量门禁：

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

## 实现顺序

1. 定义 Hermes shared types、控制面 routes 与 CLI contract
2. 实现 Hermes provider adapter 与 session recovery contract
3. 实现 Control API、context assembler、proposal store、dispatcher
4. 实现 `stoa-ctl` CLI
5. 实现 Hermes surface 与三栏 UI
6. 增补 unit / renderer / e2e / behavior coverage tests
7. 跑完整质量门禁

## 验收标准

- Stoa 顶层新增 `Hermes surface`
- Hermes surface 左栏支持多个 Hermes sessions
- 中栏运行真实 Hermes agent TUI
- Hermes agent 可以通过 `stoa-ctl` 读取全局状态
- Hermes agent 可以读取任意 work session 的 `context --level full`
- Hermes agent 可以对任意 work session 发起 prompt 输入
- 高风险动作默认 proposal + approval
- proposal 执行前做 stale-check
- Hermes session 的恢复机制与其他 provider 同类，依赖 provider 自身 resume 方案
- 所有实现通过仓库质量门禁
