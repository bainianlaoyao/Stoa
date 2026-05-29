# stoa-ctl 统一 Session Tree 控制面设计

日期：2026-05-29

> 本设计是 breaking change。原型阶段不做兼容层、不做兼容迁移。
>
> 本设计替代并收束两条旧方向：
>
> - `docs/superpowers/specs/2026-05-07-meta-session-global-agent-design.md`
> - `docs/superpowers/specs/2026-05-12-stoa-ctl-work-session-lifecycle-design.md`

## 背景

当前 `stoa-ctl`、控制面服务、IPC、renderer store 和 UI surface 仍然围绕独立 `meta session` 建模。

这带来 4 个结构性问题：

- `stoa-ctl` 只天然服务于 meta session，不天然服务于普通 session
- session 控制能力被拆成两套：普通 work session 一套，meta session 一套
- 前端 session 视图是平面的 `Project -> Sessions`，无法把 sub session 作为一等对象管理
- 由 session 自己创建出来的子 session 无法稳定进入前端的统一可见状态

同时，当前 work session 后端事实源已经是集中式的：

- 主进程维护权威 session 状态
- renderer 通过 bootstrap + IPC push 同步 session
- 所有 session 都已经是 provider-managed runtime

因此，当前问题不是“缺一个第三套子系统”，而是要把已有 session 体系收束成：

- 一个统一 session 模型
- 一个统一控制面
- 一个统一前端 session tree

## 目标

- 移除独立 `meta session` 产品概念
- 让所有 session 都暴露 `stoa-ctl`
- 让 `stoa-ctl` 提供统一的 session 子代理控制能力：
  - 创建 session
  - 销毁 session
  - 探查 session
  - prompt session
- 用 `parentSessionId` 把 session 组织成显式 session tree
- 让任意来源创建的 sub session 都进入前端统一 session tree，并可检查、选择和管理
- 把“session 内调用 `stoa-ctl`”的可见性收束为树内局部可见，而不是全局可见
- 保持主进程为唯一权威 session supervisor

## 非目标

- 不保留旧 `meta-session:*` IPC / store / surface 作为兼容层
- 不保留旧 `proposal` / `dispatch` 作为统一控制主路径
- 不把 renderer 改成直接调用 `/ctl/*` HTTP 控制面
- 不做跨 tree 的 session 可见性
- 不做任意复杂的多级权限 DSL
- 不做旧状态文件到新状态文件的迁移工具

## 核心决策

### 1. Session 是唯一控制对象

系统中只保留一种一等控制对象：`SessionSummary`。

不再有与之并列的 `MetaSessionSummary` 产品概念。

### 2. Session tree 是显式关系，不是 UI 推断

session 层级关系必须由数据模型显式表达，不允许由标题、顺序或当前 active 状态推断。

唯一权威关系字段是：

- `parentSessionId`

### 3. 主进程是唯一权威 supervisor

CLI 和 renderer 都只是客户端。

它们都必须通过主进程权威服务访问 session graph、生命周期、权限和可见性。

### 4. 用户视角与 session 视角分离

用户在前端中可以看到完整 session 图。

但一个 session 在运行时通过 `stoa-ctl` 看见的 scope 不是全局，而是严格受 session tree 规则约束。

### 5. 可见性不等于完全同权

“看得见”不代表“可以做所有有副作用的动作”。

本设计明确区分：

- visibility scope
- authority scope

## 术语

### Root Session

`parentSessionId = null` 的 session。

它是一个 session tree 的根。

### Child Session / Sub Session

`parentSessionId != null` 的 session。

在本设计中，`sub session` 与 `child session` 同义。

### Session Tree

从某个 root session 出发，通过 `parentSessionId` 向下展开形成的有根树。

一个 session 只能属于一个 tree。

### Depth

session 到其 root 的边数。

- root depth = `0`
- root 的直接子 session depth = `1`
- 以此类推

### Same-Depth Peer

在同一 session tree 内，与当前 session 深度相同的其它 session。

### Descendant

在同一 session tree 内，以当前 session 为祖先节点的所有后代 session。

## Session 模型

共享模型基于**现有** `SessionSummary` 做增量扩展，而不是重写整个状态契约。

现有 `SessionSummary` 上已有的 runtime / observability / sequence 字段全部保留，例如：

- `lastStateSequence`
- `lastTurnOutcome`
- `runtimeState`
- `turnState`
- 现有时间戳与 summary 字段

新增字段只有：

```ts
interface SessionSummary {
  parentSessionId: string | null
  createdBySessionId: string | null
}
```

说明：

- `parentSessionId`：权威层级关系
- `createdBySessionId`：审计字段，记录是谁创建了这个 session
- `createdBySessionId` **不参与** 可见性、权限和 tree 投影
- `rootSessionId` 不持久化，由主机侧派生
- `depth` 不持久化，由主机侧派生
- `childSessionIds` 不持久化，由主机侧投影

### Session Read Model

持久化模型与前端 / 控制面读模型分离。

主机侧对 renderer、`stoa-ctl inspect` 和 `session:event` 暴露的读模型为：

```ts
interface SessionTreeMeta {
  rootSessionId: string
  depth: number
  childCount: number
  descendantCount: number
}

interface SessionNodeSnapshot {
  session: SessionSummary
  tree: SessionTreeMeta
}
```

约束：

- `SessionSummary` 是持久化与 runtime 基础对象
- `SessionNodeSnapshot` 是主机侧派生后的 transport/read object
- renderer 不自行从原始平面数组推测 `rootSessionId` / `depth`
- `rootSessionId` / `depth` 只在 read model 中出现，不写回磁盘

## Session Tree 约束

### 1. 同一 project 内建树

child session 必须继承 parent 的 `projectId`。

不允许跨 project 挂接 child session。

### 2. Root session 由用户或全局上下文创建

当用户在前端显式创建顶层 session 时：

- `parentSessionId = null`
- 创建一个新的 session tree

### 3. Session 内部创建默认只创建 direct child

当某个 session 自己通过 `stoa-ctl session create` 创建新 session 时：

- 默认 parent 就是调用者自己
- 结果一定是调用者的 direct child

这是本设计的强约束。

不允许 session 内部绕过自身，直接把新 session 挂到某个 sibling、ancestor 或其它 branch 下。

### 4. Destroy 作用于完整 subtree

当目标 session `X` 被 destroy 时，作用范围不是单节点，而是：

- `X`
- `X` 的全部 descendants

系统必须执行 **recursive subtree destroy**，不允许产生 orphan session。

具体规则：

- 不做 reparent
- 不保留活的孤儿节点
- 不允许“只销毁 parent，保留 child 挂空”
- 执行顺序采用 leaf-first recursive stop/archive

结果语义：

- subtree 内所有 session runtime 被停止
- subtree 内所有 session 进入 archived 状态
- `parentSessionId` 保留，用于后续 subtree restore

### 5. Restore 与 Destroy 对称

destroy 的逆操作是 subtree restore。

当用户对某个 archived session 执行 restore 时：

- restore 目标 session
- 递归 restore 其全部 archived descendants

本期不提供“从已归档 subtree 中只恢复单个中间 child，但不恢复其后代”的特化语义。

## Session 内部可见性 Contract

这是本设计新增的强约束。

当 **一个 session 自己使用 `stoa-ctl`** 时，它只能看见当前 tree 中的局部范围。

记当前调用者为 `S`，它所在 tree 为 `T`，则：

### 可见集合 `V(S)`

`V(S)` 包含：

- `S` 自己
- `T` 中所有与 `S` 深度相同的 session
- `S` 的所有 descendants

### 不可见集合

`V(S)` 不包含：

- `S` 的 ancestors
- sibling 的 descendants
- 其它 tree 的任意 session
- 其它 project 的任意 session

### 例子

```text
R(depth 0)
├─ A(depth 1)
│  └─ A1(depth 2)
└─ B(depth 1)
   └─ B1(depth 2)
```

- `R` 可见：`R, A, B, A1, B1`
- `A` 可见：`A, B, A1`
- `B` 可见：`A, B, B1`
- `A1` 可见：`A1, B1`

这正是“同一深度的所有线程可见，以及当前 session 的所有下属 session 可见”的产品语义。

### 递归解释

这个规则对 root session 和任意深度的 sub session **完全一致**。

它不是“沿用 parent 的可见集”，而是“每个 session 站在自己的位置重新计算可见集”。

也就是说：

- root session 从 depth `0` 看 tree
- child session 从 depth `1` 看 tree
- grandchild session 从 depth `2` 看 tree

如果上面的例子继续扩展：

```text
R
├─ A
│  └─ A1
│     └─ A1a
└─ B
   └─ B1
      └─ B1a
```

则：

- `A1` 可见：`A1, B1, A1a`
- `A1` 不可见：`A, R, B, B1a`

这就是“sub session 也只关心 session tree 里的同级和下级 session”的精确定义。

### 归档对象

默认 `session list` 不返回 archived session。

若显式指定 `--include-archived`，则只在可见集合内附加 archived session。

## Authority Contract

可见性和权限分开定义。

### 用户 / 前端上下文

用户从 renderer 发起的动作拥有全局视角，可以：

- 查看所有 session
- 选择任意 session
- 在任意 project 创建 root session
- 在任意 session 下创建 child session
- prompt 任意 session
- destroy 任意 session

### Session 调用上下文

session 自己通过 `stoa-ctl` 调用时，权限如下：

| 动作 | self | same-depth peers | descendants | ancestors | peer descendants | other trees |
|------|------|------------------|-------------|-----------|------------------|-------------|
| `inspect` | 允许 | 允许 | 允许 | 不允许 | 不允许 | 不允许 |
| `prompt` | 允许 | 允许 | 允许 | 不允许 | 不允许 | 不允许 |
| `create` | 允许，且只创建 direct child | 不允许 | 不允许 | 不允许 | 不允许 | 不允许 |
| `destroy` | 允许 | 不允许 | 允许 | 不允许 | 不允许 | 不允许 |

这个矩阵对任意深度 session 等价适用，不因为它是 root、child 还是 grandchild 而改变。

设计理由：

- `inspect` / `prompt` 允许横向协作
- `create` 必须保持树结构单向扩张，避免 branch 间相互篡改 parent
- `destroy` 只允许 self 与 descendants，避免 sibling 之间的横向破坏

### 可见性泄漏约束

对于 session 调用上下文：

- 不可见 session 与不存在 session 一律返回 `unknown_session`
- 只有“目标可见，但该动作无权执行”时，才返回 `forbidden_authority_scope`

这样可以避免通过错误码探测不可见节点是否存在。

## 产品形态

### 1. 移除独立 Meta Session Surface

顶层独立 `meta-session` surface 删除。

不再保留独立的：

- meta session 列表
- meta session terminal deck
- meta session inspector panel
- meta session proposal panel

### 2. 保留一个统一 Command Surface

session 相关 UI 收束到现有 workspace / command surface。

用户在这个 surface 内看到：

- project 列
- root sessions
- child session tree
- archived subtree section
- active session terminal deck

独立 archive activity surface 不再作为 session 管理主路径。

archived session 必须保留在同一个 command surface 内，以 project-local 的 archived section 呈现，而不是跳到另一套 session 管理 surface。

### 3. Sub Session 是用户可见一等对象

child session 必须：

- 在树中有自己的稳定节点
- 可以被选中
- 可以被 inspect
- 可以被 prompt
- 可以被 destroy
- 可以显示 provider / runtime / archived 状态

## CLI 设计

`stoa-ctl` 收束为统一 session 控制客户端。

### 顶层命令

```bash
stoa-ctl health
stoa-ctl whoami
stoa-ctl capabilities
stoa-ctl session list [--include-archived]
stoa-ctl session create --type <shell|opencode|codex|claude-code> [--title "..."] [--project <projectId>] [--parent <sessionId>]
stoa-ctl session inspect <sessionId> [--view summary|context|events|tree] [--level status|bundle|full]
stoa-ctl session prompt <sessionId> --text "..."
stoa-ctl session destroy <sessionId>
```

### Caller 解析 Contract

`stoa-ctl` 的 caller 解析必须收束为两类，且不再存在“active meta session fallback”：

#### Session caller

当环境中同时存在：

- `STOA_SESSION_ID`
- `STOA_CTL_SESSION_TOKEN`
- `STOA_CTL_BASE_URL`

则 CLI 以该 session 身份调用控制面。

#### Local user caller

当不存在 session caller 环境时：

- CLI 以本地用户身份调用
- 使用 port file 中的主机侧 secret 做本地管理员鉴权

#### 禁止的旧行为

以下旧行为全部删除：

- 通过 `activeMetaSessionId` 猜测 caller
- 通过“当前激活控制 session”做隐式 fallback

没有 target 的命令按 caller 语义执行：

- `whoami`
- `capabilities`
- `session list`

需要 target 的命令必须显式提供 target。

### 语义

#### `session list`

- 用户上下文：列出全局 session
- session 上下文：只列出可见集合 `V(S)`
- 返回对象必须是 `SessionNodeSnapshot[]`，不是裸 `SessionSummary[]`
- 默认 JSON 输出是平面节点数组，节点之间靠 `session.id` 与 `session.parentSessionId` 关联
- 人类可读输出可以按 project/tree 打印缩进视图，但这只是 display format，不是权威数据结构

#### `session create`

- 用户上下文：
  - `--project` 必填
  - 未指定 `--parent` 时创建 root session
  - 指定 `--parent` 时创建该 parent 的 direct child
- session 上下文：
  - `--project` 禁止显式传入
  - `--parent` 禁止显式传入
  - 新 session 必须创建为调用者自己的 direct child

#### `session inspect`

- `summary`：最小结构化元数据
- `context --level status`：快速状态层
- `context --level bundle`：结构化上下文包
- `context --level full`：人类可读纯文本上下文
- `events`：结构化事件摘要
- `tree`：**caller-filtered** 的目标 subtree 视图

#### `session prompt`

- 直接向目标 session 注入 prompt
- 不保留旧 meta-only proposal / dispatch 流程

#### `session destroy`

用户面向的单一语义是 `destroy`。

主机内部语义收束为：

- leaf-first stop subtree runtime
- release subtree host resources
- recursive archive subtree

本期不提供 `purge history`。

#### `inspect --view tree` 过滤规则

`tree` 视图必须受 caller visibility 过滤。

规则：

- 对 self：返回 self 为根的完整可见 subtree
- 对 visible descendant：返回该 descendant 为根的完整可见 subtree
- 对 same-depth peer：只返回该 peer 节点本身，不返回它的 descendants
- 不返回 ancestors
- 不返回 caller 不可见的 branch 占位节点

## CLI 输出 Contract

### `whoami`

`whoami` 必须明确返回当前 caller 的身份与 scope。

示例：

```json
{
  "ok": true,
  "data": {
    "callerType": "session",
    "sessionId": "session_A",
    "projectId": "project_1",
    "rootSessionId": "session_R",
    "depth": 1,
    "visibility": {
      "mode": "same-depth-plus-descendants"
    },
    "permissions": {
      "inspect": true,
      "promptPeers": true,
      "createChild": true,
      "destroyPeers": false,
      "destroyDescendants": true
    }
  },
  "error": null
}
```

当是本地用户上下文时，`callerType = "local-user"`，且不返回 `sessionId` / `rootSessionId` / `depth`。

### `capabilities`

必须返回：

- 支持的命令
- 当前 caller 的 authority scope
- `inspect` 支持的 view / level

### 输出形式

- 默认 `stdout` 输出 JSON envelope
- `context --level full` 默认输出纯文本
- `stderr` 只放诊断

### `session list` JSON 形状

`session list` 的 `data` 必须至少包含：

```ts
interface SessionListResponseData {
  nodes: SessionNodeSnapshot[]
}
```

约束：

- `nodes` 是 caller-filtered 结果
- local-user caller 收到全局节点
- session caller 收到 `V(S)` 内节点
- `SessionNodeSnapshot.tree.depth` 与 `rootSessionId` 始终由主机侧派生
- CLI 不自行在本地推导 tree metadata 作为权威值

## 后端架构

推荐新增并收束为以下主机侧模块：

- `SessionSupervisor`
- `SessionControlServer`
- `SessionVisibilityService`
- `SessionCommandEnv`
- `SessionBootstrapPromptService`
- `SessionCallerAuthRegistry`

职责如下。

### `SessionSupervisor`

统一拥有：

- create session
- destroy session
- inspect session
- prompt session
- session graph 派生
- active session 协调
- 资源清理

它是 CLI / IPC 共用的业务入口。

### `SessionControlServer`

替代当前 `meta-session-control-server`。

要求：

- 仍然只监听 loopback
- 仍然使用本地 port file 发现
- 不再要求 caller 必须是 meta session
- 允许 caller 是任意 live session 或用户本地上下文

### `SessionCallerAuthRegistry`

这是新的强制模块，用来让 authority contract 可执行。

鉴权规则：

#### Local user caller

- 使用 port file 中的主机 secret
- 通过 `x-stoa-secret` 访问
- 拥有全局用户权限

#### Session caller

主机在 session runtime 启动时，为每个 live session mint 一个随机 `session control token`。

注入环境变量：

- `STOA_SESSION_ID`
- `STOA_CTL_SESSION_TOKEN`
- `STOA_CTL_BASE_URL`

请求时必须同时携带：

- `x-stoa-session-id`
- `x-stoa-session-token`

服务端校验：

- session 存在
- session runtime 当前 live
- token 与 live session registry 中记录一致

以下情况直接拒绝：

- session 已停止
- session 已归档
- token 缺失
- token 不匹配

token 约束：

- token 不写入持久化状态文件
- token 在 runtime stop / destroy 后立即失效
- child session 不继承 parent token

### `SessionVisibilityService`

统一计算：

- rootSessionId
- depth
- visible set
- authority matrix

不允许每个 route handler、CLI handler、IPC handler 各自手写可见性逻辑。

### `SessionCommandEnv`

替代当前只服务 meta session 的 env 注入逻辑。

要求：

- 所有 provider-managed session 都注入 `stoa-ctl`
- 所有 session 都注入 `STOA_SESSION_ID`
- 所有 session 都注入 `STOA_CTL_SESSION_TOKEN`
- 所有 session 都注入 `STOA_CTL_BASE_URL`
- `shell` session 有命令但没有 agent bootstrap prompt

### `SessionBootstrapPromptService`

替代“你正在一个 meta session 里”的旧 bootstrap prompt。

新 prompt 必须只描述：

- 你当前的 session 身份
- 你的 tree-local visibility rule
- 你可以通过 `stoa-ctl` 做什么
- 你不能控制什么

## 持久化设计

统一沿用现有 project session 持久化主路径。

### 1. child session 与普通 session 共用一个持久化文件

child session 继续存储在：

- `<project>/.stoa/sessions.json`

### 2. 删除独立 meta session 持久化作为产品状态源

以下旧状态不再作为产品权威输入：

- `~/.stoa/meta-session.json`

实现可以：

- 忽略它
- 删除它
- 或在开发环境提示它已过期

但不做迁移逻辑。

### 3. 派生字段不持久化

以下内容必须实时派生，不持久化：

- `rootSessionId`
- `depth`
- `descendantCount`
- visible set

### 4. control token 不持久化

以下内容必须是 runtime-only：

- `STOA_CTL_SESSION_TOKEN`
- live session token registry

## Renderer 同步设计

这是本设计最关键的落点。

当前前端对新 session 的首次可见依赖 `session:create` invoke 返回值手动 `addSession`。

这不足以覆盖“由另一个 session 在后台创建 child session”的场景。

因此必须改成：

### 1. `session:event` 成为统一 upsert 入口

`session:event` 必须覆盖：

- create
- update
- archive
- restore
- destroy

事件 contract 必须升级为显式 envelope：

```ts
interface SessionGraphEvent {
  kind: 'created' | 'updated' | 'archived' | 'restored' | 'destroyed'
  graphVersion: number
  origin: 'renderer' | 'local-cli' | 'session' | 'system'
  initiatorSessionId: string | null
  node: SessionNodeSnapshot
}
```

约束：

- `graphVersion` 单调递增
- renderer 用 `graphVersion` 去重和拒绝过期事件
- `kind = "created"` 是 parent auto-expand 的唯一触发器
- push event 本身永远不负责切换 active session
- `node` 必须始终携带创建/更新后的完整 `SessionNodeSnapshot`

### 2. renderer 收到未知 session 时必须插入

store 不能再假设事件只会更新已存在对象。

必须提供统一 `upsertSession(session)` 语义：

- 已存在则更新
- 不存在则插入

### 3. 创建来源不影响前端可见性

无论 session 是由谁创建的：

- 用户前端
- CLI
- 另一个 session 的 `stoa-ctl`

只要主机侧确认创建成功并广播 `session:event`，前端都必须能看到。

### 4. Tree projection 改为显式父子投影

当前 `projectHierarchy` 只会做 `Project -> Sessions`。

新投影必须改成：

- `Project`
- `Root Sessions`
- `Child Sessions` 递归树

bootstrap 也必须直接返回 `SessionNodeSnapshot[]`，而不是只返回裸 `SessionSummary[]`。

renderer 只基于主机派生后的 node snapshots 做 tree 渲染，不自行计算 depth/root 作为权威值。

### 4.1 Archived projection 也保留 tree 结构

为了让用户能稳定检查和管理 sub session，archived session 不能退化成“丢失 parent 信息的平面回收站列表”。

renderer 必须在每个 project 内同时维护两棵 forest：

- `liveRoots`
- `archivedRoots`

其中：

- `liveRoots` = `archived = false` 且 `parentSessionId = null` 的 roots
- `archivedRoots` = `archived = true`，且满足以下任一条件的 archived subtree 入口：
  - `parentSessionId = null`
  - parent 不存在
  - parent 存在但 `parent.archived = false`

解释：

- 如果 destroy 的是 root subtree，则整个 subtree 进入 project 的 archived roots
- 如果 destroy 的是一个 active parent 下面的 child subtree，则这个 child 作为 archived subtree 入口出现在 project 的 archived section 中
- archived subtree 内部的 parent / child 关系继续保留，不允许被投影成平面孤立行

### 4.2 Archived section 的 UI 规则

每个 project 在 command surface 内必须有一个可折叠 archived section：

- collapsed by default
- 使用与 live tree 相同的递归 row renderer
- 节点继续显示 child count / provider / runtime / archived badge
- `Restore` 对 archived subtree root 与其中的 archived descendants 都可见
- 不要求自动切到 archived 节点，但要求用户能稳定展开并定位它

### 5. 背景创建 child session 时不自动抢焦点

如果 child session 不是由当前前端用户直接创建：

- 插入 tree
- 自动展开 parent
- 更新计数 / badge
- 不自动切换 active session

如果当前前端用户通过本窗口显式创建 child session：

- local invoke 返回值可以切换 active session
- 但 push event 仍然只做 upsert，不做焦点切换

## 前端交互设计

### 左侧 Session Tree

`WorkspaceHierarchyPanel` 改成递归 session tree。

每个 session row 至少显示：

- title
- provider type
- runtime state
- archived state
- child count
- 是否 sub session 的层级缩进

project row 下的结构固定为：

- live session tree
- archived section

不再存在独立 meta-session tree，也不再存在另一套平面 archived session surface 作为主管理入口。

### Session Row 动作

用户在前端的 session row 上至少能执行：

- `Create Child`
- `Inspect`
- `Prompt`
- `Destroy`
- `Restore`

说明：

- `Destroy` 是唯一主路径上的 stop/archive 动作
- `Restore` 只对 archived subtree 可见
- 不再并列保留一个单独的 `Archive` row action

### 右侧 Terminal Deck

选中任意 root 或 child session，都能在 terminal deck 中查看其终端与回放。

### Visual 约束

所有新增 UI 必须继续遵循：

- `docs/engineering/design-language.md`

要求：

- 使用共享 design tokens
- 保持 glass / clean / premium 层次
- tree 行和 action 控件不用重边框
- session id / path / provider command 等精确标识继续使用 mono 字体

## IPC 设计

renderer 继续只通过 Electron preload / IPC 与主机交互。

不让 renderer 直接调用 `/ctl/*`。

至少需要扩展的能力：

- `session:create-child`
- `session:prompt`
- `session:destroy`
- `session:inspect`

或等价地，把这些收束进已有 `session:*` 通道族。

关键点不是命名，而是：

- 业务逻辑必须共用 `SessionSupervisor`
- renderer 与 CLI 不能形成两套不同语义

## 错误语义

新增以下错误必须是一等 contract：

- `unknown_session`
- `unknown_project`
- `forbidden_visibility_scope`
- `forbidden_authority_scope`
- `invalid_parent_session`
- `cross_project_parent_forbidden`
- `internal_error`

补充约束：

- session caller 请求不可见节点时返回 `unknown_session`
- visible 但无权 destroy / create / prompt 时返回 `forbidden_authority_scope`
- renderer / local-user 全局调用不使用 `forbidden_visibility_scope`

## 测试策略

### 单元测试

- session tree depth / root 派生
- visible set 计算
- authority matrix 计算
- in-session create 只能创建 direct child
- destroy 只允许 self / descendants

### 主进程 / IPC 测试

- CLI 创建 child session
- CLI prompt visible peer session
- CLI inspect visible descendant
- CLI destroy descendant
- CLI destroy same-depth peer 被拒绝
- 后台 child create 触发 `session:event`

### Renderer / Store 测试

- `upsertSession` 可以插入未知 session
- `projectHierarchy` 正确投影 parent / child 关系
- `projectHierarchy` 正确投影 archived subtree 入口与 archived descendants
- 背景 child create 不抢 active session
- parent auto-expand 与 badge 更新
- grandchild session 只看见同 depth peer 与自身 descendants

### E2E

- 用户创建 root session
- session 通过 `stoa-ctl` 创建 child session
- child session 自动显示在前端 tree
- sibling session 通过 `stoa-ctl` 可 inspect / prompt 同深度 peer
- grandchild session 通过 `stoa-ctl` 只能看见同 depth peer 与自身 descendants
- sibling session 无法 destroy 同深度 peer
- root session 可以看到并管理整棵 tree

### 质量门禁

实现完成后必须通过：

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

## 实现顺序

1. 扩展 shared `SessionSummary`，引入 `parentSessionId` / `createdBySessionId`
2. 在主机侧实现 `SessionSupervisor` 与 `SessionVisibilityService`
3. 替换 `meta-session-control-server` 为统一 `SessionControlServer`
4. 把 `stoa-ctl` 收束为统一 `session` 命令面
5. 给所有 session runtime 注入统一 `stoa-ctl` env
6. 删除独立 meta session store / IPC / UI stack
7. 改造 renderer store 为 tree projection + `upsertSession`
8. 改造 `WorkspaceHierarchyPanel` 与 terminal deck
9. 补齐 unit / IPC / renderer / e2e / behavior coverage

## 验收标准

- 系统中不再存在独立产品级 `meta session` 概念
- 所有 provider-managed session 都能使用 `stoa-ctl`
- `stoa-ctl` 支持 `create / inspect / prompt / destroy`
- session tree 由显式 `parentSessionId` 驱动
- session 内调用 `stoa-ctl` 时，只能看到：
  - 同 tree 同 depth session
  - 当前 session 的 descendants
- 这个规则对任意深度 sub session 等价生效
- session 内调用 `destroy` 时，不能销毁 same-depth peer
- 后台创建的 child session 会自动显示在前端
- archived subtree 在同一个 command surface 内保持 tree 结构可见
- 前端统一只保留一个 session 管理主 surface
- 所有实现通过仓库质量门禁

## 参考上下文

- [research/2026-05-29-stoa-ctl-current-architecture.md](</D:/Data/DEV/ultra_simple_panel/research/2026-05-29-stoa-ctl-current-architecture.md>)
- [research/2026-05-29-session-backend-topology.md](</D:/Data/DEV/ultra_simple_panel/research/2026-05-29-session-backend-topology.md>)
- [research/2026-05-29-session-frontend-topology.md](</D:/Data/DEV/ultra_simple_panel/research/2026-05-29-session-frontend-topology.md>)
- [research/2026-05-29-orca-cli-session-patterns.md](</D:/Data/DEV/ultra_simple_panel/research/2026-05-29-orca-cli-session-patterns.md>)
- [research/2026-05-29-session-cli-best-practices.md](</D:/Data/DEV/ultra_simple_panel/research/2026-05-29-session-cli-best-practices.md>)
