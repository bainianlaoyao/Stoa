# 产品实现总计划（自治执行版）

## 文档目的

本文件用于把 Stoa 多会话管理框架从“已具备最小可运行骨架”推进到“整个产品实现完成”。

这里的“完成”不是指做出一个演示样机，而是指：

- 核心运行时完整
- 真实 provider 接入完成
- 多工作区管理完成
- 状态通道、恢复机制、扩展边界完成
- 前端功能工作台完成
- 打包与稳定性达到可长期使用水平

本计划明确采用 **自治执行模式**：执行过程中默认不需要任何人类决策，AI 必须依据现有文档、代码现状、测试结果和工程直觉，自主选择推荐实现路径并持续推进，直到整个产品完成。

## 执行原则

### 1. 总目标高于局部漂亮

任务目标是完成整个产品，而不是局部精修某个子模块。

### 2. 样式极简，功能优先

前端样式保持简单、克制、易替换。后续允许整体重写视觉风格，因此当前阶段不得把时间浪费在视觉打磨上，但功能行为必须完整。

### 3. 前端任务必须带 Vue 规范 skill

所有 Vue / Pinia / 组件 / 模板 / renderer store 相关任务，必须使用：

- `vue-best-practices`
- `test-driven-development`

### 4. 无人类决策依赖

执行过程中，除非遇到真正不可从代码、文档、日志、外部资料中推断的阻塞，否则不得停下来请求人类批准、决策或偏好确认。默认使用 AI 自己的推荐方案。

### 5. 后端真相优先

必须先保证 provider、状态流、恢复机制和运行时能力成立，再让前端去映射它们。前端不得反向定义后端语义。

### 6. 每一阶段必须可验证

每个阶段结束时都必须运行：

- `npx pnpm test`
- `npx pnpm typecheck`
- `npx pnpm build`
- 必要的 `npx electron-vite preview` 或等价手工运行验证

## 当前基础状态

当前仓库已经具备：

- Electron + Vite + Vue + TypeScript 工程
- `node-pty` + `xterm.js` 最小可运行链路
- preload 白名单桥接
- 最小 SessionManager
- Express 本地 webhook server 接线点
- `~/.stoa/state.json` 最小持久化与恢复
- 单工作区、本地 shell provider、最小终端运行演示

当前不完整之处：

- 未接入真实 Agent CLI provider
- 未完成多工作区并发管理
- 未完成 sidecar 鉴权与完整 canonical event 校验
- 未完成白盒扩展区的真正注册机制
- 未完成打包、原生依赖收尾与稳定性闭环

## 产品完成的主任务树

### Phase A：真实 Provider 与会话核心完成

目标：从本地 shell 演示切换到真实 CLI provider 驱动。

必须完成：

- `opencode` provider 落地
- provider capability contract 全量实现
- `buildStartCommand` / `buildResumeCommand`
- session id 解析
- sidecar 注入
- provider 降级策略

推荐 skills：

- `test-driven-development`
- `systematic-debugging`
- `writing-plans`
- 如需外部资料：`research` / `librarian`

### Phase B：状态通道与事件契约完成

目标：让状态事件真正成为系统唯一事实来源。

必须完成：

- webhook sidecar 接入
- loopback only + per-workspace secret
- canonical event envelope 校验
- 幂等去重
- 状态机合法迁移判断
- SessionManager 状态合成

推荐 skills：

- `test-driven-development`
- `systematic-debugging`
- `verification-before-completion`

### Phase C：多工作区运行时完成

目标：从单工作区演示升级为多工作区并发产品能力。

必须完成：

- 多 PTY / 多 provider 实例并发
- 左侧多工作区控制台
- 切换时终端实例保活
- active workspace 输入路由
- 工作区卡片状态与运行摘要

推荐 skills：

- `test-driven-development`
- `systematic-debugging`
- `verification-before-completion`
- 如拆并行子任务：`subagent-driven-development`

### Phase D：恢复机制完成版

目标：让产品具备可靠恢复能力。

必须完成：

- `active_workspace_id` 恢复
- 真实 `last_cli_session_id` 恢复
- provider 不支持 resume 时进入 `needs_confirmation`
- 路径失效、坏文件、无 session 的降级
- provisional → authoritative 状态切换

推荐 skills：

- `test-driven-development`
- `systematic-debugging`
- `verification-before-completion`

### Phase E：前端功能工作台完成

目标：保持样式简单，但功能完整。

必须完成：

- 多工作区控制台
- 主终端区
- 状态灯 / 摘要 / degraded / error / exited / needs_confirmation 展示
- 恢复中提示
- 终端输入、输出、resize、重连反馈

前端约束：

- 不做复杂主题系统
- 不做视觉精修
- 不做高成本动画
- 只做足够清晰、可替换的样式层

推荐 skills：

- `vue-best-practices`
- `test-driven-development`

### Phase F：白盒扩展体系完成

目标：让 `extensions/providers` 和 `extensions/panels` 真正可挂载。

必须完成：

- provider registry
- panel 注册机制
- 共享状态受控访问
- 不越权的扩展边界

推荐 skills：

- `writing-plans`
- `test-driven-development`
- 必要时 `oracle`

### Phase G：打包与稳定性收尾

目标：让项目可长期使用，而不只是开发时可跑。

必须完成：

- `node-pty` rebuild / packaging
- Electron 打包
- native addon / ASAR 处理
- 日志、故障快照、调试输出
- Windows 环境下稳定验证

推荐 skills：

- `systematic-debugging`
- `verification-before-completion`
- 如需查资料：`research` / `librarian`

## 推荐执行顺序

必须按以下顺序推进，除非代码证据明确表明应调整顺序：

1. Phase A：真实 Provider
2. Phase B：状态通道
3. Phase D：恢复机制
4. Phase C：多工作区运行时
5. Phase E：前端功能工作台
6. Phase F：白盒扩展体系
7. Phase G：打包与稳定性

这个顺序的原则是：

- 先做后端真相
- 再做恢复能力
- 再做并发管理
- 最后让前端映射系统真相

## 任务完成判定

只有在下面全部成立时，才可视为“整个产品完成”：

1. 能启动真实 CLI provider，而不是仅本地 shell
2. 能并发管理多个工作区
3. 能在终端中看到真实输出并进行输入交互
4. 能接收和处理真实结构化状态事件
5. 能在重启后恢复工作区与 CLI 会话
6. 前端工作台功能完整且状态反馈正确
7. 扩展体系可挂载 provider / panel
8. `test` / `typecheck` / `build` / 运行验证全部通过
9. Windows 打包与运行链路闭合

## 执行提示

本计划不是“供人阅读后再决定是否继续”的参考资料，而是一个可以直接驱动实现到底的自治计划。

后续任何 AI 执行者都应默认：

- 目标是完成整个产品
- 中途不需要人类决策
- 一切按 AI 推荐与工程直觉推进
- 样式从简，功能做全
- Vue 任务必须使用 `vue-best-practices`
