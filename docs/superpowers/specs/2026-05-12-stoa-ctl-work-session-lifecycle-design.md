# stoa-ctl Work Session Lifecycle 设计

日期：2026-05-12

## 背景

当前 `stoa-ctl` 已经能够通过控制面读取和操作 work session 的部分信息：

- `work-sessions list`
- `work-sessions get`
- `work-sessions events`
- `work-sessions context`
- `work-sessions prompt`
- `work-sessions send-keys`

但它还不能覆盖用户在前端对 work session 的两个核心生命周期操作：

- 创建一个新的 work session
- 点击 archive 图标归档一个 work session

项目目标是让 `stoa-ctl` 成为完整的 Stoa 命令行控制面，即用户能在前端完成的 work session 操作，CLI 也必须能完成。

## 目标

- 为 `stoa-ctl` 新增 `work-sessions create`
- 为 `stoa-ctl` 新增 `work-sessions archive`
- 让 `archive` 的行为严格等同于前端点击 archive 图标后触发的完整流程
- 让 `create` 的默认 title 生成行为与前端一致
- 不让 agent 在 prompt 中自行猜测或生成 title
- 复用现有主进程和 session manager 能力，不引入第二套 work session 生命周期语义

## 非目标

- 不新增 `close` / `delete` / `purge` 等其他生命周期命令
- 不实现 work session `restore` CLI
- 不改变现有前端交互或 session manager 的持久化结构
- 不做兼容性别名，例如把 `archive` 再映射成 `close`

## 命令面设计

新增命令：

```bash
stoa-ctl work-sessions create --project <projectId> --type <shell|opencode|codex|claude-code> [--title "..."]
stoa-ctl work-sessions archive <sessionId>
```

### `work-sessions create`

规则：

- `--project` 必填
- `--type` 必填
- `--title` 可选
- 未提供 `--title` 时，由 Stoa 主机侧按前端现有规则生成默认 title
- `stoa-ctl` 只负责透传显式 title；它不在 CLI 层自行猜测默认 title

### `work-sessions archive`

规则：

- 参数只有 `sessionId`
- 行为必须严格等同于用户点击前端 archive 图标
- 不引入 CLI 特供语义

## 语义对齐

### 1. `create` 等同前端新建 session

前端当前调用 `window.stoa.createSession({ projectId, type, title })`，主进程处理后会：

1. 通过 `projectSessionManager.createSession(...)` 创建 session 记录
2. 同步 observability 和 update state
3. 立即触发 `launchSessionRuntimeWithGuard(...)`

因此 `stoa-ctl work-sessions create` 的语义不是“只建一条记录”，而是“创建并启动一个 session”，与前端一致。

### 2. `archive` 等同前端 archive 图标

前端当前调用 `window.stoa.archiveSession(sessionId)`，主进程处理后会：

1. `sessionInputRouter.resetSession(sessionId)`
2. `ptyHost.killAndWait(sessionId)`
3. `hookLeaseManager.releaseLease(sessionId)`
4. `projectSessionManager.archiveSession(sessionId)`
5. 同步 observability、push snapshot、同步 update state

`stoa-ctl work-sessions archive` 必须严格复用这条路径，而不是只把 `archived=true` 写回 manager。

## 默认 title 设计

当前前端 work session 的标题生成规则在 renderer 层：

- `shell`：`shell-<当前 project 下 shell session 数量 + 1>`
- 其它 provider：`<descriptor.titlePrefix>-<project.name>`

本次需要把这套逻辑上收为主机侧权威逻辑，原因是：

- title 当前并不作为前端主要展示字段
- 不希望 agent 在 prompt 中“创作” title
- CLI 和前端若各自生成默认 title，后续会漂移

因此：

- 默认 title 由 Stoa 主机侧生成
- 前端和 `stoa-ctl` 都可以把 title 留空，由主机侧补齐
- 若调用方显式传入 `title`，则使用该值

## 控制面设计

新增控制面路由：

```http
POST /ctl/work-sessions
POST /ctl/work-sessions/:sessionId/archive
```

### `POST /ctl/work-sessions`

请求体：

```json
{
  "projectId": "project_1",
  "type": "codex",
  "title": "codex-myproj"
}
```

其中 `title` 可选。

响应：

```json
{
  "ok": true,
  "data": {
    "id": "session_x",
    "projectId": "project_1",
    "type": "codex"
  },
  "error": null
}
```

### `POST /ctl/work-sessions/:sessionId/archive`

响应：

```json
{
  "ok": true,
  "data": {
    "session": {
      "id": "session_x",
      "archived": true
    }
  },
  "error": null
}
```

## 错误语义

沿用现有控制面错误风格：

- 缺少 `projectId` / `type` 或 `type` 非法：`400 invalid_request`
- `projectId` 不存在：`400 invalid_request`
- `sessionId` 不存在：`404 unknown_session`
- 其它未预期异常：`500 internal_error`

## 实现边界

### CLI

`tools/stoa-ctl/index.ts` 负责：

- 暴露 usage 文本
- 解析 `--project` / `--type` / `--title`
- 发起 HTTP 请求

CLI 不负责：

- 生成默认 title
- 自行判断 archive 该做哪些 runtime 清理

### 控制面

`src/core/meta-session-control-server.ts` 负责：

- 解析和校验 work session lifecycle 请求
- 复用主机侧权威能力
- 返回统一 envelope

### 主机侧

`src/main/index.ts` 负责：

- 把控制面 work session create/archive 连接到现有主进程行为
- 确保 archive 走与前端相同的完整路径
- 确保 create 走与前端相同的创建 + 启动路径

## 测试策略

### 1. CLI 单测

在 `tools/stoa-ctl/index.test.ts` 新增：

- `work-sessions create` 组装请求
- `work-sessions archive` 组装请求
- `create` 未传 `--title` 时仍能成功请求主机侧默认 title

### 2. 控制面单测

在 `src/core/meta-session-control-server.test.ts` 新增：

- `POST /ctl/work-sessions` 成功创建
- `POST /ctl/work-sessions/:id/archive` 成功归档
- invalid type / missing project / unknown session 等错误分支

### 3. 主进程集成验证

通过已有全量 `vitest` / `Playwright` / `behavior-coverage` 质量门验证：

- 不回归原有 session lifecycle
- 不破坏现有 control plane

## 推荐方案

推荐采用“控制面镜像现有产品语义”的方案：

- CLI 只做显式参数入口
- 业务语义统一在 Stoa 主机侧
- 默认 title 在主机侧权威生成
- archive 严格复用前端路径

不推荐新增 `close` 或 CLI 侧生成默认 title，因为这两者都会制造第二套不受主机约束的语义。
