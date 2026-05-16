# X Promotion Autopilot 设计

日期：2026-05-16

## 背景

Stoa 准备做一轮面向 X 平台的持续宣传。当前约束已经明确：

- 发布主体是个人账号，不额外维护官方账号矩阵。
- 目标是让更多 AI CLI 重度用户知道 Stoa，并尽量把认知转成 GitHub stars。
- 内容要有 builder account 的人味，不能像广告机。
- 主帖允许自动发布。
- 进入别人帖子下互动时，必须先生成草稿，再由人类决定是否发送。
- 实现要尽量简洁，更多依赖大模型自身判断，而不是堆大量程序化规则。
- 运行时直接使用用户主浏览器 profile 的 X 登录态。

同时，X 当前的自动化边界不适合做“关键词群回 + 近重复刷屏”的增长脚本。本次方案必须把自动化集中在低风险、高重复的部分，把公开互动保留为人审门。

## 目标

- 在仓库内落地一条最小可跑通的 X 宣传自动化管线。
- 每次运行能够从素材目录和仓库事实源生成当天候选主帖。
- 每次运行能够从 X 搜索结果中发现相关讨论，并生成回复草稿队列。
- 支持自动发布当天选中的主帖。
- 支持对回复草稿做人工选择后再发送。
- 把运行历史、已发内容、已拒绝草稿保存为轻量记忆，以便下一轮避免重复。

## 非目标

- 不做多平台分发。
- 不做复杂仪表盘或 Web UI。
- 不做数据库、队列服务或常驻后台服务。
- 不做自动化回复别人帖子。
- 不做下载转化、星标归因或复杂数据分析。
- 不做高频发帖、批量改写旧帖、趋势劫持或任何接近 spam 的策略。

## 推荐方案

采用“prompt-first 的半自动 builder-notes 引擎”：

- 程序层只负责收集素材、读取仓库事实、调用大模型、保存输出和执行浏览器自动化。
- 大模型负责判断当天该讲什么、如何保持人味、哪些讨论值得介入、每条回复怎样更自然。
- 主帖默认可以自动发布。
- 回复别人之前必须显式人工选择一个草稿再发送。

不采用多规则、多服务的运营系统，也不采用高风险全自动互动机器人。

## 系统结构

实现结构分为四层：

### 1. Source Pack

输入源固定为两类：

- `automation/promo/assets/`
  - 用户手动放入的截图、GIF、短视频、对比图、备注文本。
- 仓库事实源
  - `README.md`
  - `README.zh-CN.md`
  - `docs/product/promotion-copy.md`
  - `release-notes-*.md`

程序只做薄整理，不做复杂规则提取。输出一个 `fact-pack.json`，其中包含：

- 项目基本信息
- 仓库文本片段
- 素材列表与 sidecar 备注
- 近期发帖历史摘要

### 2. Daily Orchestrator

每日主循环用一次大模型调用完成：

- 输入：
  - `fact-pack.json`
  - 最近发帖和回复历史
  - X 搜索得到的相关讨论摘要
  - 固定 voice prompt
- 输出：
  - `3-5` 条候选主帖
  - 其中 `1-2` 条建议当天发布
  - 值得关注的相关讨论
  - 每条讨论对应 `1-3` 条回复草稿

这里的主导逻辑不在代码里，而在 prompt 里。

### 3. Execution Lane

浏览器自动化只承担最后执行：

- 打开 X 发帖页
- 填写主帖文本
- 上传素材
- 点击发布
- 打开目标帖子并发送被人工选中的回复

浏览器自动化直接复用本机 `kimi-webbridge` daemon，不再引入 Playwright 登录态管理。

### 4. Memory

只保留轻量状态文件：

- 已发主帖历史
- 已生成回复队列
- 已发送回复
- 被拒绝的草稿
- 下一轮需要避免重复的主题

状态不做数据库化，只落 JSON / Markdown 文件。

## 目录设计

第一版目录固定为：

```text
automation/promo/
  assets/
  config/
    search-queries.json
    voice.md
    settings.json
  out/
  state/
```

仓库代码固定为：

```text
src/core/promo/
tools/promo/
```

其中：

- `src/core/promo/` 放可测试的 Node/TypeScript 逻辑。
- `tools/promo/` 放命令行入口。

## 内容策略

自动化系统默认遵守以下内容约束：

- 英文主发。
- 优先讲真实观察、真实摩擦、真实构建理由，而不是产品广告词。
- 主帖只使用四类角度：
  - `pain-note`
  - `build-note`
  - `tiny-proof`
  - `sharp-opinion`
- CTA 只允许软性引导到 GitHub，不催下载、不做销售漏斗。
- 回复别人时必须先提供有用观点，再轻量提及 Stoa。

这些约束主要存在于 prompt 文本中，程序只做最小护栏。

## 程序护栏

程序层只保留五个硬护栏：

1. 事实必须来自素材或仓库文本，不允许编造引用。
2. 主帖不能与近期已发内容近似重复。
3. 广告腔表达需要在发布前被二次过滤。
4. 回复别人必须显式选择后发送。
5. 每次运行的主帖和回复数量保持低频。

除此之外，不再引入更多规则引擎。

## 命令面

第一版命令行界面：

```bash
tsx --tsconfig tsconfig.node.json tools/promo/index.ts smoke
tsx --tsconfig tsconfig.node.json tools/promo/index.ts run-daily [--publish]
tsx --tsconfig tsconfig.node.json tools/promo/index.ts publish-posts [--all|--id <postId>]
tsx --tsconfig tsconfig.node.json tools/promo/index.ts send-reply --id <replyId> --option <n> [--yes]
```

### `smoke`

验证：

- `kimi-webbridge` daemon 健康
- X compose 页面可访问
- 当前登录态下能读取基础页面结构

### `run-daily`

完成：

- 读取素材和仓库事实
- 收集 X 搜索结果
- 调用大模型生成候选主帖和回复队列
- 输出 `today-posts.json` / `today-posts.md`
- 输出 `reply-queue.json` / `reply-queue.md`
- `--publish` 时自动发布被标记为 `publishToday` 的主帖

### `publish-posts`

从 `today-posts.json` 中发送待发布主帖。

### `send-reply`

读取 `reply-queue.json` 中指定项，按给定 option 选择草稿发送。没有 `--yes` 时只打印预览，不真正发送。

## 浏览器自动化实现边界

X 页面结构变化快，因此自动化实现遵循：

- 优先用稳定选择器：
  - `div[role="textbox"]`
  - `input[type="file"]`
  - `button[data-testid="tweetButton"]`
  - `button[data-testid="reply"]`
- 必要时回退到 DOM `evaluate` 脚本而不是复杂可访问性树解析。
- 每次执行使用独立 webbridge session 名称，任务完成后关闭 session。

## LLM 实现边界

第一版只做一个本地可执行模型适配器，不做多 provider 编排。

默认适配器使用本机 `claude -p --json-schema ...`：

- 它支持结构化 JSON 输出。
- 它适合把大段 `fact pack` 和搜索摘要交给模型判断。
- 后续如需替换为 `codex exec` 或其他 CLI，再通过配置切换。

## 输出文件

每次运行至少生成：

- `automation/promo/out/fact-pack.json`
- `automation/promo/out/today-posts.json`
- `automation/promo/out/today-posts.md`
- `automation/promo/out/reply-queue.json`
- `automation/promo/out/reply-queue.md`

状态文件至少包含：

- `automation/promo/state/post-history.json`
- `automation/promo/state/reply-history.json`
- `automation/promo/state/run-log.json`

## 异常处理

- 若 `kimi-webbridge` 不健康，直接失败并提示先修复浏览器桥。
- 若 X 搜索抓取失败，仍允许退化为“只基于素材生成主帖”。
- 若素材不足，模型应退化为 `build-note` / `sharp-opinion`，而不是编造卖点。
- 若主帖发布失败，保留输出文件，不丢失已生成内容。
- 若回复发送失败，队列项保持未发送状态，便于重试。

## 测试策略

### 单元测试

至少覆盖：

- `fact pack` 生成
- 历史去重与轻量记忆整理
- orchestrator 提示词输入/输出编排
- webbridge 请求封装
- 发布与回复命令的 dry-run 行为

### 集成测试

至少覆盖：

- `run-daily` 在 mock LLM / mock webbridge 下生成完整输出
- `publish-posts` 在 mock webbridge 下发送主帖
- `send-reply` 在 mock webbridge 下预览与发送回复

### 手工 smoke

真实线上只做手工 smoke：

- `smoke`
- `run-daily`
- `run-daily --publish` 先用低风险短帖验证
- `send-reply --id ... --option ... --yes` 手工验证一条回复

## 成功标准

满足以下条件即认为第一版实现完成：

- 仓库内有一条可以本地运行的最小宣传管线。
- 它能基于 Stoa 素材和仓库事实生成英文主帖候选。
- 它能基于 X 搜索结果生成回复队列。
- 它能自动发布主帖到 X。
- 它不会自动发送未被显式确认的回复。
- 它把本轮结果和历史写回本地状态文件。

