# Evolver 集成 Gap 分析报告

> 生成日期: 2026-04-27
> 范围: Stoa Direct Memory 管线 vs Evolver 完整能力面的差距分析

---

## 执行摘要

Stoa 当前只利用了 Evolver 约 **30%** 的能力面。集成仅覆盖了无 LLM 的核心循环（信号扫描 → Gene 选择 → GEP prompt → 记录），没有接入 Evolver 三个需要 LLM 或 Hub 连接的关键子系统：**Skill Distiller**、**LLM Review**、**Hub Memory API**。

这导致记忆质量受限于规则管道的上限：注入新会话的内容是 git diff 统计 + 正则标签，缺乏语义提取和上下文关联。

---

## 1. Evolver 完整能力面清单

### 1.1 核心进化循环（无 LLM，已集成 ✅）

| 模块 | 文件 | 职责 | Stoa 状态 |
|---|---|---|---|
| `evolve.js` | 核心引擎（混淆） | 扫描 memory/ → 信号匹配 → Gene/Capsule 选择 → 输出 GEP prompt | ✅ 已集成 |
| `selector.js` | 资产选择器 | 根据信号从 assets/gep/ 选择最优 Gene/Capsule | ✅ 通过 evolve run 间接使用 |
| `prompt.js` | GEP prompt 生成器 | 组装协议约束的进化指令 | ✅ 通过 evolve run 间接使用 |
| `mutation.js` | 变异对象 | 每次进化运行由显式 Mutation 对象控制 | ✅ 通过 evolve run 间接使用 |
| `personality.js` | 人格状态 | 可进化的 PersonalityState | ✅ 通过 evolve run 间接使用 |
| `solidify.js` | 固化验证 | 执行 Gene 的 validation 命令，验证通过后固化 | ✅ 通过 EvolverClient 可用 |
| `strategy.js` | 策略预设 | balanced/innovate/harden/repair-only | ✅ 通过环境变量配置 |
| `signals.js` | 信号提取 | 正则模式匹配 | ✅ 已使用 |
| `assetStore.js` | 资产存储 | genes.json/capsules.json 管理 | ✅ 通过 evolve run 间接使用 |
| `analyzer.js` | 日志分析器 | 扫描 memory/ 下的日志和信号 | ✅ 通过 evolve run 间接使用 |
| `envFingerprint.js` | 环境指纹 | 记录运行环境特征 | ✅ 通过 evolve run 间接使用 |

### 1.2 Hook 管道（无 LLM，已集成 ✅）

| 脚本 | 触发时机 | 功能 | Stoa 状态 |
|---|---|---|---|
| `evolver-session-start.js` | 会话启动 | 读 memory_graph.jsonl 最后 5 条，格式化注入 | ✅ 通过 wrapper 脚本使用 |
| `evolver-session-end.js` | 会话结束 | git diff → 信号检测 → outcome 写入 memory_graph.jsonl | ✅ 通过 wrapper 脚本使用 |
| `evolver-signal-detect.js` | PostToolUse(Write) | 实时关键词信号检测 | ✅ 通过 wrapper 脚本使用 |

### 1.3 Skill Distiller（需要外部 LLM，未集成 ❌）

| 函数 | 作用 | LLM 依赖 |
|---|---|---|
| `collectDistillationData()` | 从 capsules + events 收集蒸馏数据 | 否（数据准备） |
| `analyzePatterns()` | 分析成功/失败模式 | 否（规则分析） |
| `buildDistillationPrompt()` | 生成给 LLM 的蒸馏 prompt | 否（prompt 生成） |
| `extractJsonFromLlmResponse()` | 从 LLM 回复中提取 Gene JSON | **需要 LLM 回复** |
| `validateSynthesizedGene()` | 验证 LLM 生成的 Gene | 否（验证） |
| `shouldDistill()` | 判断是否应该触发蒸馏 | 否（阈值判断） |
| `prepareDistillation()` | 准备蒸馏 prompt 文件 | 否（文件写入） |
| `completeDistillation(responseText)` | 处理 LLM 回复，生成 Gene | **需要 LLM 回复** |
| `autoDistill()` | 从已有 Gene 模式合成新 Gene（无 LLM） | 否（模式重组） |
| `synthesizeGeneFromPatterns()` | 纯规则模式合成 | 否 |
| `shouldDistillFromFailures()` / `autoDistillFromFailures()` | 失败模式蒸馏 | 否（规则） |

**关键工作流**:
1. `prepareDistillation()` 生成一个 `.txt` prompt 文件
2. 人类或外部系统用 LLM 处理该 prompt
3. 将 LLM 回复保存到文件
4. 运行 `node index.js distill --response-file=<path>` 调用 `completeDistillation()`
5. 产出新的 Gene，写入 `assets/gep/genes.json`

**Stoa 的现状**: 完全没有接入。`index.js` 中的 `distill` 命令和 `autoDistill` 函数从未被 Stoa 调用。

### 1.4 LLM Review（需要外部 LLM，未集成 ❌）

| 文件 | 函数 | 作用 |
|---|---|---|
| `llmReview.js` | `buildReviewPrompt()` | 构建代码变更审查 prompt |
| | `runLlmReview()` | 调用外部 LLM 审查 diff |
| | `isLlmReviewEnabled()` | 检查 `EVOLVER_LLM_REVIEW=true` |

**关键发现**（`llmReview.js` 第65-69行）：

```js
// 当前实现：自批准占位符
const reviewScript = `
  console.log(JSON.stringify({ approved: true, confidence: 0.7,
    concerns: [], summary: 'auto-approved (no external LLM configured)' }));
`;
```

这是一个**占位实现**——它不调用真正的 LLM，而是直接返回 `{ approved: true }`。设计意图是用户替换这段脚本为真正的 LLM 调用（比如 claude、gemini），但默认状态下是自动批准。

**Stoa 的现状**: 没有设置 `EVOLVER_LLM_REVIEW=true`，该模块完全不激活。

### 1.5 Hub 连接（需要网络 + Hub 账号，未集成 ❌）

| 模块 | 功能 | Stoa 状态 |
|---|---|---|
| `a2aProtocol.js` | Hub 通信协议（hello/heartbeat/publish/fetch） | ❌ 未接入 |
| `hubSearch.js` | 搜索 Hub 上的公共 Gene/Capsule | ❌ |
| `hubReview.js` | Hub 端审查流程 | ❌ |
| `hubVerify.js` | Hub 验证 | ❌ |
| `memoryGraphAdapter.js` | Hub Memory Graph 适配器 | ❌ |
| `taskReceiver.js` | 从 Hub 接收并执行任务 | ❌ |
| `validator/` | 去中心化验证节点 | ❌ |
| `proxy/` | 本地 Proxy 邮箱架构 | ❌ |

**Hub Memory API（`/a2a/memory/recall`）**:
- 接受 `query` + `signals` + `limit` 参数
- **可能**在 Hub 端有语义检索能力（向量化匹配）
- 形成真正的 "recall before, record after" 闭环
- Stoa 完全没有使用

### 1.6 记忆子系统（部分依赖 LLM/Hub，未集成 ❌）

| 模块 | 功能 | LLM 依赖 | Stoa 状态 |
|---|---|---|---|
| `narrativeMemory.js` | 叙事记忆层（30 条 / 12KB 上限） | 可能有 | ❌ |
| `reflection.js` | 反思循环 | 可能需要 LLM | ❌ |
| `memoryGraph.js` | 本地记忆图管理 | 否 | ❌ 只用了 JSONL 文件直接读写 |
| `memoryGraphAdapter.js` | Hub 记忆图适配 | 需要 Hub | ❌ |
| `curriculum.js` | 课程学习 | 可能需要 LLM | ❌ |
| `learningSignals.js` | 学习信号提取 | 否 | ❌ |
| `executionTrace.js` | 执行轨迹记录 | 否 | ❌ |

### 1.7 其他未集成模块

| 模块 | 功能 | Stoa 状态 |
|---|---|---|
| `explore.js` | 空闲周期探索（打破局部最优） | ❌ |
| `idleScheduler.js` | OMLS 空闲调度 | ❌ |
| `selfPR.js` | 自主 PR 生成 | ❌ |
| `skillPublisher.js` | 技能发布到 Hub | ❌ |
| `skill2gep.js` | Skill 转 GEP 资产 | ❌ |
| `questionGenerator.js` | 紧急问题生成 | ❌ |
| `issueReporter.js` | 自动 GitHub Issue 报告 | ❌ |
| `directoryClient.js` | Agent 目录搜索 | ❌ |
| `privacyClient.js` | 隐私计算客户端 | ❌ |
| `localStateAwareness.js` | 本地状态感知 | ❌ |
| `candidates.js` / `candidateEval.js` | 候选方案评估 | ❌ |
| `atp/` (8 files) | Agent Transaction Protocol | ❌ |

---

## 2. 具体差距分析

### Gap 1: 记忆内容缺乏语义 — 最大的结构性缺陷

**现状**:
- `evolver-session-end.js` 用 git diff 统计 + 正则信号写入 `memory_graph.jsonl`
- `evolver-session-start.js` 读取最后 5 条，格式化为文本注入
- `published-context-builder.ts` 用 `summary`（事件名如 `"Stop"`）或 `prompt_text`（原文）作为注入内容
- `evolver-input-importer.ts` 原文搬运 `transcript_text` 和 `prompt_text`

**缺失**:
- 没有任何环节对对话内容做语义摘要
- `transcript_text`（包含用户意图、决策理由、尝试过的方案）被原样搬运但从未被提取或压缩
- 注入新会话时无法根据新会话的相关性做语义筛选，只能按时间窗口取"最后 5 条"

**Evolver 提供但未使用的能力**:
- `buildDistillationPrompt()` 可以生成给 LLM 的蒸馏 prompt，让 LLM 从 capsules + events 中提取结构化的策略知识
- `narrativeMemory.js` 可以维护一个带容量控制的叙事记忆层（30 条 / 12KB）
- Hub `/a2a/memory/recall` 可以做语义检索

**影响**: 新会话收到的"记忆"是低信噪比的 git diff 统计，而不是"上次会话做了什么、为什么、学到了什么"。

### Gap 2: Skill Distiller 完全未接入 — 无法从经验中提炼策略

**现状**: Stoa 的 `EvolverClient` 只调用了 `run`、`review`、`approveReview`、`rejectReview` 四个命令。`distill` 命令从未被调用。

**缺失**:
- 没有 `autoDistill()` 的集成 —— 即使是纯规则模式合成也不会触发
- 没有 `prepareDistillation()` → LLM → `completeDistillation()` 的完整工作流
- 没有 `shouldDistillFromFailures()` / `autoDistillFromFailures()` 的失败模式蒸馏

**影响**: 积累的 capsules 和 events 从未被二次处理。Evolver 每次运行都从零开始做信号匹配，无法从历史成功/失败中提炼出更精准的策略。

### Gap 3: LLM Review 未启用 — 进化产出无质量把关

**现状**: `EVOLVER_LLM_REVIEW` 环境变量未设置。即使设置了，默认实现也只是返回 `{ approved: true }` 的占位符。

**缺失**:
- 没有配置 `EVOLVER_LLM_REVIEW=true`
- 没有替换 `llmReview.js` 中的占位脚本为真正的 LLM 调用
- Evolver 的 solidify 流程缺少 AI 审查环节

**影响**: 低质量的进化产出（如 `stable_success_plateau` 信号的空操作 Gene）会直接通过并写入记忆，污染 memory_graph。

### Gap 4: Hub 连接完全缺失 — 无跨会话/跨项目记忆共享

**现状**: Stoa 的 `src/` 目录中没有任何对 `a2a/memory`、`A2A_HUB_URL`、`hubSearch` 等的引用。

**缺失**:
- Hub Memory API (`/a2a/memory/recall` / `/a2a/memory/record`) 未接入
- 跨项目的 Gene/Capsule 共享未实现
- Hub 语义检索能力未利用
- 去中心化验证未参与
- Proxy 邮箱架构未部署

**影响**: 记忆完全局限于单个项目的 `memory_graph.jsonl` 文件，无法跨项目复用经验。

### Gap 5: `summary` 字段的语义真空

**现状**: `hook-event-adapter.ts` 将 `summary` 设为 `hookEventName`（`"Stop"`、`"UserPromptSubmit"`）。`entire-bridge` 导出的 checkpoint 中 `summary` 取决于 Provider 本地是否存储了有意义的摘要。

**缺失**: 没有任何环节用 LLM 从 `transcript_text` 生成有意义的 session summary。

**影响**: `published-context-builder.ts` 中 `buildProviderHookNote()` 优先使用 `summary`，但 summary 经常是 `"Stop"` 这样无意义的值。回退到 `prompt_text` 虽然有用户输入但缺少 LLM 生成的上下文。

### Gap 6: 注入机制缺乏上下文感知

**现状**: `evolver-session-start.js` 的注入逻辑：
1. 读 `memory_graph.jsonl` 最后 5 条
2. 格式化为固定模板
3. 一次性注入，不区分新会话的任务类型

**缺失**:
- 没有根据新会话的初始 prompt 做相关性筛选
- 没有利用 Hub 的 `/a2a/memory/recall` 做语义检索
- 没有利用 `learningSignals.js` 做信号优先级排序
- 没有利用 `idleScheduler.js` 做注入时机优化

**影响**: 注入的内容可能完全无关（上次修 auth bug 的 diff 统计注入到 UI 重构会话中），浪费 context window 且引入噪音。

### Gap 7: 信号检测粒度不足

**现状**: `detectSignals()` 使用 7 个正则模式：
- `log_error`, `perf_bottleneck`, `user_feature_request`, `user_improvement_suggestion`, `capability_gap`, `deployment_issue`, `test_failure`

**缺失**:
- 没有利用 `learningSignals.js` 的更细粒度信号
- 没有信号衰减机制（Gene 权重衰减）
- 没有信号去饱和检测（`evolution_saturation`, `force_steady_state`）
- 信号完全基于 git diff 文本，无法捕获非代码层面的学习（如用户偏好、架构决策）

---

## 3. Evolver 模块覆盖率统计

```
总模块数:     99 files (src/ 下)
已集成使用:    12 files  (~12%)
间接使用:      ~8 files  (~8%, 通过 evolve run)
完全未使用:   ~79 files  (~80%)

功能维度:
  ✅ 核心进化循环:        100%  (run + solidify)
  ❌ Skill Distiller:       0%  (完全未接入)
  ❌ LLM Review:            0%  (未启用 + 占位实现)
  ❌ Hub 连接:              0%  (完全未接入)
  ❌ 记忆子系统:           ~10%  (只用了 JSONL 直接读写)
  ❌ Hook 管道:           100%  (3/3 脚本已用)
  ❌ ATP/Proxy/Validator:   0%  (完全未接入)
  ❌ 探索/反思/叙事:        0%  (完全未接入)
```

---

## 4. 关键文件索引

### Stoa 侧（集成代码）

| 文件 | 职责 | 使用的 Evolver 能力 |
|---|---|---|
| `src/core/direct-memory/completion-service.ts` | 会话事件监听 → 采集调度 | 监听 `agent.turn_completed` |
| `src/core/direct-memory/entire-client.ts` | entire-bridge CLI 封装 | `checkpoints` + `export` |
| `src/core/direct-memory/evolver-client.ts` | Evolver CLI 封装 | `run`, `review`, `approve`, `reject` |
| `src/core/direct-memory/orchestrator.ts` | 演化与发布编排 | worktree → run → publish |
| `src/core/direct-memory/published-context-builder.ts` | 发布上下文构建 | 读取 Evolver run 产出 |
| `src/core/direct-memory/context-delivery.ts` | 写出 JSONL + CLAUDE.md | 写 `.stoa/generated/` |
| `src/core/direct-memory/evolver-input-importer.ts` | Checkpoint → Evolver 格式 | 写 MEMORY.md / USER.md |
| `src/core/direct-memory/bridge-store.ts` | 去重与持久化 | bridge-refs.json |
| `src/core/direct-memory/worktree.ts` | Git worktree 管理 | `git worktree add` |
| `src/core/hook-event-adapter.ts` | Provider hook 事件适配 | `summary = hookEventName` |

### Evolver 侧（已集成 vs 未集成）

| 模块 | 已集成 | 说明 |
|---|---|---|
| `evolve.js` | ✅ | 通过 `node index.js run --json` |
| `evolver-session-start.js` | ✅ | 通过 wrapper 脚本 |
| `evolver-session-end.js` | ✅ | 通过 wrapper 脚本 |
| `evolver-signal-detect.js` | ✅ | 通过 wrapper 脚本 |
| `skillDistiller.js` | ❌ | 从未被 Stoa 调用 |
| `llmReview.js` | ❌ | 未启用且为占位实现 |
| `narrativeMemory.js` | ❌ | 混淆，未接入 |
| `reflection.js` | ❌ | 混淆，未接入 |
| `explore.js` | ❌ | 未接入 |
| `a2aProtocol.js` | ❌ | Hub 通信未接入 |
| `hubSearch.js` | ❌ | Hub 搜索未接入 |
| `memoryGraphAdapter.js` | ❌ | Hub 记忆未接入 |
| `proxy/` (8 files) | ❌ | Proxy 架构未部署 |
| `atp/` (8 files) | ❌ | ATP 协议未接入 |

---

## 5. 结论与建议方向

当前集成是一个**"骨架接入"**——Stoa 正确地串通了 Evolver 的核心管道（采集 → worktree 隔离 → run → 发布 → 注入），但只利用了 Evolver 的规则化底层，没有触及需要 LLM 或 Hub 的增值层。

三个最值得优先补齐的 gap（按投入产出比排序）：

1. **Session Summary 语义提取** — 在会话结束时用 LLM 从 `transcript_text` 生成结构化摘要（而非 `"Stop"`），这是最直接的记忆质量提升，改动最小
2. **Skill Distiller 接入** — 让 Stoa 在 orchestrator 中接入 `prepareDistillation()` → LLM → `completeDistillation()` 工作流，从积累的 capsules/events 中提炼策略 Gene
3. **Hub Memory API 接入** — 利用 `/a2a/memory/recall` 做语义检索替代"最后 5 条"的硬截断
