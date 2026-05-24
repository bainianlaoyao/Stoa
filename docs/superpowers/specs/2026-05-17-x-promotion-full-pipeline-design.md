# X Promotion Full Pipeline 设计

日期：2026-05-17

## 背景

`2026-05-16-x-promotion-autopilot-design.md` 已经定义并落地了第一阶段：

- 基于仓库事实和 promo 素材生成当天主帖候选
- 自动发布主帖
- 生成回复草稿队列
- 回复保持人审发送

当前要补的是第二阶段，把“素材获取”和“内容节奏规划”也推进到可执行实现，形成一条手动触发、链路完整、尽量依赖大模型自身判断的本地宣传流水线。

## 目标

- 让 `promo` 不再依赖用户手动准备全部素材。
- 每次运行都可以自动补齐一批可用的基础宣传素材。
- 每次运行都可以生成一个 7 天内容计划，减少当天即兴拼帖。
- 保留“主帖可自动发、互动保持人审”的安全边界。
- 提供一个手动触发的一键全链路命令。

## 非目标

- 不做定时后台任务。
- 不做自动回复陌生人的 X 帖子。
- 不做多平台分发。
- 不做复杂运营规则系统。
- 不把宣传系统做成单独服务或 Web 后台。
- 不要求这一阶段自动生成剪辑视频或 GIF，截图优先，后续可补短动图。

## 推荐方案

采用“自动素材工厂 + 周计划器 + 日运行器”的三段式方案：

1. 自动素材工厂负责把已有 README 截图自动纳入 promo 素材池，并用 Playwright/Electron 启动本地应用补抓一批真实 UI 截图。
2. 周计划器用同一个本地结构化 LLM，根据事实包、素材池和近期已发主题，生成未来 7 天的内容安排。
3. 日运行器继续生成当天候选主帖和回复草稿，但额外读取周计划上下文，保证当天内容和周节奏一致。

这是最符合当前约束的方案：

- 风险最低：不扩大对外自动互动边界。
- 实现简单：复用现有 promo 核心、Claude CLI 适配器、Playwright/Electron 测试夹具。
- 模型主导：选题、节奏、写法、素材组合都交给模型判断，程序只做薄编排。

## 自动素材工厂

### 素材来源

自动素材工厂固定接三类来源：

1. `docs/assets/readme/` 已有截图
2. 本地 Electron 应用的自动新截图
3. 用户以后手动补充到 `automation/promo/assets/` 的额外素材

### 自动截图策略

这一阶段只抓最基础、最稳定、最能说明问题的原子素材：

- 工作区总览
- 多 provider 会话存在感
- 恢复后的会话状态

实现上不追求复杂演示脚本，只跑 2 到 3 个稳定场景，优先保证每次都能产出可发素材，而不是追求花哨镜头。

### 输出

自动素材工厂至少写出：

- `automation/promo/assets/generated/...`
- 每个素材对应的 sidecar `.md` 备注
- `automation/promo/out/asset-manifest.json`

备注文本保持非常薄，只提供真实功能上下文，让后续 LLM 自己决定如何使用。

## 周计划器

周计划器读取：

- `fact-pack.json`
- 当前素材池
- 近期发帖历史
- voice prompt

输出未来 7 天的内容计划：

- 日期
- 主题
- 切入角度
- 为什么今天讲它
- 建议搭配的素材
- 一句 seed text

输出文件：

- `automation/promo/out/week-plan.json`
- `automation/promo/out/week-plan.md`

周计划不做硬约束，而是作为当天生成的高优先级上下文。

## 日运行器增强

现有 `run-daily` 保留，但增强为：

- 读取并注入当天 week plan 条目
- 让模型优先围绕当天主题选材和写帖
- 如果周计划不存在，退化回第一阶段逻辑

这样可以把“长期节奏”与“当天真实搜索痛点”结合起来：

- 主帖更稳定
- 回复草稿仍然来自当天真实讨论

## 一键全链路命令

新增三个命令：

```bash
tsx --tsconfig tsconfig.node.json tools/promo/index.ts build-assets
tsx --tsconfig tsconfig.node.json tools/promo/index.ts plan-week
tsx --tsconfig tsconfig.node.json tools/promo/index.ts run-full [--publish]
```

语义如下：

- `build-assets`
  - 自动生成/同步基础素材池
- `plan-week`
  - 生成 7 天计划
- `run-full`
  - 先跑素材工厂
  - 再跑周计划器
  - 再跑当日 orchestrator
  - `--publish` 时自动把当天建议主帖发出

`run-daily`、`publish-posts`、`send-reply` 原有命令继续保留。

## 目录与文件调整

新增或扩展以下产物：

```text
automation/promo/
  assets/
    generated/
  out/
    asset-manifest.json
    fact-pack.json
    today-posts.json
    today-posts.md
    reply-queue.json
    reply-queue.md
    week-plan.json
    week-plan.md
```

程序侧新增：

```text
src/core/promo/asset-factory.ts
src/core/promo/week-planner.ts
```

并扩展：

- `src/core/promo/types.ts`
- `src/core/promo/promo-paths.ts`
- `src/core/promo/fact-pack.ts`
- `src/core/promo/daily-orchestrator.ts`
- `tools/promo/index.ts`

## 内容策略补充

自动素材和周计划优先覆盖这些基础卖点原子：

- 本地优先
- Apache-2.0 开源非商业
- 多项目 / 多会话 / 多 provider
- 会话恢复
- session 状态管理
- 优雅的新建 session
- meta session
- 快速迭代与 release 节奏
- 测试与行为覆盖带来的稳定性

程序不把这些卖点写死成强规则，只把它们作为模型的可选素材池。

## 失败与退化策略

- 如果 Playwright/Electron 自动截图失败，保留 README 已有截图并继续后续流程。
- 如果周计划生成失败，不阻断 `run-daily`。
- 如果当天没有任何新截图，也允许模型基于历史素材和 repo facts 正常产帖。
- 如果发布失败，保留所有中间产物供人工接手。

## 测试策略

新增单元测试覆盖：

- 新路径与输出文件
- 自动素材工厂的 manifest 与 sidecar 输出
- 周计划器的 JSON / Markdown 产物
- `run-full` 的顺序编排
- fact-pack 对嵌套 generated 素材目录的读取

真实自动截图不放进单元测试里，保持通过依赖注入做假实现。真实链路只在手工 smoke 时验证。

## 成功标准

满足以下条件即可认为第二阶段完成：

- `promo build-assets` 能自动补齐一批基础素材
- `promo plan-week` 能生成 7 天计划
- `promo run-full` 能串起素材、计划、当天内容生成和可选发布
- `run-daily` 能读取周计划上下文
- 整个流程继续保持“主帖自动、互动人审”的边界
- 仓库测试门禁全部通过
