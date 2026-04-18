# Vibecoding Product Completion Prompt

你现在的唯一任务目标是：**完成整个 Vibecoding 极简多会话管理产品**。

这不是一个“做到某个阶段就停”的任务，也不是一个“补几个功能”的任务，而是要持续推进，直到整个产品达到可交付、可运行、可恢复、可扩展、可验证的完成状态。

## 最高优先级目标

你必须把当前仓库从“已有最小骨架与局部运行能力”推进到“整个产品实现完成”。

完成的定义不是样式好看，而是以下能力全部成立：

1. 真实 CLI provider 接入完成
2. 状态通道与 canonical event contract 落地完成
3. 多工作区并发管理完成
4. 恢复机制完成
5. 前端功能工作台完成
6. 白盒扩展体系完成
7. 打包、原生依赖与稳定性完成

## 执行原则

### 1. 全程自治

中间不需要任何人类决策。

除非遇到真正无法从代码、文档、测试、日志、外部资料中推断的阻塞，否则不得停下来询问“要不要这样做”“选哪个方案”“是否继续”。

默认规则：**一切按 AI 自己的推荐方案、工程判断和直觉推进。**

### 2. 样式简单，功能完整

用户后续会完全重写前端风格，所以当前前端的要求是：

- 样式保持简单
- 布局清晰即可
- 不做高成本视觉打磨
- 不做主题系统、复杂动画、精细设计
- 但所有产品功能必须完整实现

### 3. 后端真相优先

必须优先完成：

- provider 内核
- 状态事件流
- 会话恢复
- 多工作区调度

前端只做这些能力的映射层，不得反向定义系统语义。

### 4. 所有 Vue 相关任务强制带 skill

只要任务涉及以下任一内容：

- `.vue` 组件
- renderer store
- App shell
- Pinia
- 模板类型
- props / emits
- 终端视图组件

就必须加载：

- `vue-best-practices`
- `test-driven-development`

### 5. 所有功能改动必须可验证

每完成一个主要阶段，都必须验证：

- `npx pnpm test`
- `npx pnpm typecheck`
- `npx pnpm build`
- 相关手工运行验证，例如 `npx electron-vite preview`

如果是 CLI/provider/terminal/recovery 相关功能，必须做真实运行验证，而不是只看类型通过。

## 你必须优先参考的仓库文档

实现时必须以仓库内文档为契约来源，优先参考：

- `docs/plans/product-completion-master-plan.md`
- `docs/plans/bootstrap-plan.md`
- `docs/architecture/dual-channel-model.md`
- `docs/architecture/state-event-contract.md`
- `docs/architecture/lifecycle-and-session-resurrection.md`
- `docs/architecture/provider-capability-contract.md`
- `docs/architecture/workspace-identity-and-state-machine.md`
- `docs/architecture/module-boundaries.md`
- `docs/engineering/local-dev-environment.md`

## 推荐执行顺序

若无更强代码证据，默认按以下顺序推进整个产品：

1. 真实 Provider 与会话核心
2. 状态通道与事件契约
3. 恢复机制完成版
4. 多工作区运行时
5. 前端功能工作台
6. 白盒扩展体系
7. 打包与稳定性收尾

## 运行时行为要求

你必须坚持以下边界：

- `node-pty` 只能在 main / core 层
- xterm.js 只能在 renderer 层
- preload 只能做白名单桥接
- renderer 不得直接访问文件系统或子进程
- Pinia 只是 projection，不是系统真相
- 状态只能来自结构化事件，不得从终端输出猜测

## 任务风格要求

你的行为方式必须是：

- 主动推进
- 不停在中间请求决策
- 发现缺口就补
- 发现文档与代码不一致就同步修正文档
- 每个阶段结束都验证
- 完成一个阶段后直接进入下一个推荐阶段

## 禁止事项

- 不要把目标缩小成“做一个阶段看看”
- 不要把前端风格优化当成主要工作
- 不要因为功能已经“能演示”就停止
- 不要在中途请求人类拍板实现方案
- 不要把视觉流和状态流混在一起

## 最终停止条件

只有在整个产品达到下面全部条件时，你才可以认为任务完成：

1. 真实 provider 可运行
2. 多工作区可管理
3. 状态事件可驱动 UI 与恢复
4. 会话重启恢复成立
5. 前端功能壳完整
6. 扩展机制可用
7. 打包和原生依赖链路闭合
8. 全部验证通过

在这之前，不要把任务描述成“完成”。
