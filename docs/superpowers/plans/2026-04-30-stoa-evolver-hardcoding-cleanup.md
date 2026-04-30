# Stoa x Evolver Hard Boundary Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 Stoa 和 bundled Evolver 之间所有 Stoa 专用补丁依赖、硬编码实验和伪能力暴露，让 `research/upstreams/evolver/**` 回到原始 upstream，而所有集成责任只留在 Stoa。

**Architecture:** `research/upstreams/evolver/**` 被视为只读第三方依赖，不允许继续承载任何 Stoa 业务代码。Stoa 侧改成一个超薄 `evolver-engine-adapter`，直接调用 raw upstream 可复用模块；凡是当前只能通过 patched `src/stoa/*`、`host-bridge`、`publish-context`、CLI JSON 协议成立的能力，默认删除而不是重建兼容层。整个改动是 breaking change，不做迁移、不做兼容。

**Tech Stack:** Electron main/preload、TypeScript、Vitest、Playwright、bundled Evolver submodule、Stoa 本地 evidence/runtime state 存储。

---

## Cleanup Rules

- 只接受 breaking change，不做兼容层，不做迁移逻辑。
- `research/upstreams/evolver/**` 必须保持 raw upstream；不在 submodule 里写任何 Stoa 代码。
- Stoa 不允许 import / require / spawn 任何 `research/upstreams/evolver/src/stoa/*` 实现。
- Stoa 不允许继续把 upstream `host-bridge`、`publish-context`、patched CLI JSON action surface 当正式接口。
- 如果某条能力只能靠旧 bridge 才存在，默认删除这条能力，不补一个“新 bridge”。
- product surface 不再暴露记忆物化调试接口；调试只通过测试、实验脚本和本地状态文件完成。
- 真实支持矩阵必须和 UI / settings / runtime type 完全一致；不允许“UI 可选但运行时报 not implemented”。
- 当前工作区已有大量无关脏改动；实施时只触碰这份计划列出的文件，不回滚未理解的其他变更。

## Scope Split

### 本次必须清掉的本地问题

- `src/core/memory/stoa-evolver-bridge.ts` 及其测试和下游命名。
- `src/core/memory/evolver-client.ts`、`command-runner.ts` 这类 CLI bridge / JSON subprocess 协议层。
- `RendererApi` 这组 memory inspection product surface：
  - `getMemoryStateSummary`
  - `traceMemoryTurn`
  - `explainMemoryRecall`
  - `getMemoryAsset`
- `src/shared/memory-runtime.ts` 里只服务旧 run/publish/worktree 流程的 Stoa-owned 契约。
- “名义支持、实际不可用”的 inference provider 选项与设置持久化值。
- `uv/pip` 污染实验，以及所有把 patched upstream surface 写成 Stoa 契约的文档/历史计划。

### 明确保留但只做宿主最小面的逻辑

- `SessionEvidenceStore`
- `RuntimeStateStore`
- `SessionEventBridge`
- `TurnMaintenanceRunner`
- provider hook protocol 适配
- Stoa-owned `evolver-engine-adapter`

### 不在 Stoa 内部解决、只做事实记录的上游约束

- raw upstream 自己的 taxonomy / prompt / threshold / asset layout
- raw upstream 如果没有某个宿主友好机读入口，Stoa 只能本地适配或删除对应产品能力，不能再把补丁写回 upstream

## File Structure

### 新增

- `src/core/memory/evolver-engine-adapter.ts`
- `src/core/memory/evolver-engine-adapter.test.ts`
- `src/core/memory/upstream-boundary-guard.test.ts`
- `research/2026-04-30-evolver-upstream-hardcoding-inventory.md`

### 删除

- `src/core/memory/stoa-evolver-bridge.ts`
- `src/core/memory/stoa-evolver-bridge.test.ts`
- `src/core/memory/host-bridge-cli.test.ts`
- `src/core/memory/evolver-client.ts`
- `src/core/memory/evolver-client.test.ts`
- `src/core/memory/command-runner.ts`
- `src/core/memory/command-runner.test.ts`
- `src/core/memory/evolver-publish-context.test.ts`
- `src/core/memory/cli-ai-schemas.ts`
- `src/core/memory/evolver-input-materializer.ts`
- `src/core/memory/evolver-input-materializer.test.ts`
- `src/core/memory/worktree.ts`
- `src/core/memory/worktree.test.ts`
- `docs/superpowers/plans/2026-04-26-entire-evolver-memory-bridge.md`
- `docs/superpowers/plans/2026-04-27-full-evolver-integration-cli-ai-provider.md`
- `docs/superpowers/plans/2026-04-28-stoa-evolver-host-orchestrator.md`
- `docs/superpowers/plans/2026-04-29-stoa-evolver-runtime-host-implementation.md`
- `docs/superpowers/specs/2026-04-25-entire-evolver-direct-integration-design.md`
- `docs/superpowers/specs/2026-04-26-entire-evolver-memory-self-evolution-design.md`
- `docs/superpowers/specs/2026-04-27-memory-plugin-architecture-design.md`
- `docs/superpowers/specs/2026-04-28-stoa-evolver-host-orchestrator-design.md`
- `docs/superpowers/specs/2026-04-29-stoa-evolver-runtime-host-design.md`

### 修改

- `src/core/memory/bundled-evolver.ts`
- `src/core/memory/bundled-evolver.test.ts`
- `src/core/memory/runtime-host.ts`
- `src/core/memory/runtime-host.test.ts`
- `src/core/memory/runtime-capabilities.ts`
- `src/core/memory/runtime-capabilities.test.ts`
- `src/core/memory/inference-router.ts`
- `src/core/memory/inference-router.test.ts`
- `src/core/memory/turn-maintenance-runner.ts`
- `src/core/memory/turn-maintenance-runner.test.ts`
- `src/core/ipc-channels.ts`
- `src/core/project-session-manager.ts`
- `src/core/project-session-manager.test.ts`
- `src/main/session-event-bridge.ts`
- `src/main/session-event-bridge.test.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/shared/memory-runtime.ts`
- `src/shared/project-session.ts`
- `src/renderer/stores/settings.ts`
- `src/renderer/stores/settings.test.ts`
- `src/renderer/stores/update.test.ts`
- `src/renderer/stores/workspaces.test.ts`
- `src/renderer/app/App.test.ts`
- `src/renderer/components/AppShell.test.ts`
- `src/renderer/components/settings/AboutSettings.test.ts`
- `src/renderer/components/settings/GeneralSettings.test.ts`
- `src/renderer/components/settings/ProvidersSettings.vue`
- `src/renderer/components/settings/ProvidersSettings.test.ts`
- `tests/e2e/main-config-guard.test.ts`
- `scripts/run-real-first-round-experiment.ts`
- `docs/engineering/evolver-data-flow.md`
- `docs/engineering/evolver-integration-gap-analysis.md`
- `research/2026-04-27-evolver-real-source-integration.md`
- `research/2026-04-28-evolver-native-hooks-and-bridge-necessity.md`
- `research/2026-04-28-evolver-memory-model-and-retrieval.md`
- `research/2026-04-28-real-llm-e2e-and-trigger-timing.md`
- `research/2026-04-28-task-7-direct-memory-migration.md`
- `research/2026-04-29-distill-trigger-and-recall-failure.md`
- `research/2026-04-29-evolver-distill-validation-dependencies.md`
- `research/2026-04-29-evolver-runtime-host-current-state.md`
- `research/2026-04-29-evolver-recall-exit-analysis.md`
- `research/2026-04-29-evolver-capsule-real-execution.md`
- `research/2026-04-29-real-memory-e2e-evidence.md`
- `research/2026-04-29-stoa-evolver-current-integration.md`
- `research/upstreams/evolver` (gitlink only; no in-tree edits)

## Task 1: 先做 raw upstream 盘点和边界守卫，不立即 repin

**Files:**
- Modify: `src/core/memory/bundled-evolver.ts`
- Modify: `src/core/memory/bundled-evolver.test.ts`
- Create: `src/core/memory/upstream-boundary-guard.test.ts`
- Create: `research/2026-04-30-evolver-upstream-hardcoding-inventory.md`

- [ ] 先盘点 raw upstream 里当前真的可直接复用的模块和函数，不预设 `warmStart/recall/review/distill` 都有稳定机读入口。
- [ ] 在 inventory 文档里给每个 Stoa 计划保留的 adapter action 标注真实来源；如果找不到 clean upstream 入口，直接记为“删除该产品能力”。
- [ ] `bundled-evolver.ts` 收紧成“repo root / raw module entrypoint 定位器”，删除 `resolveBundledEvolverCli` 这种 CLI-shaped 边界设计。
- [ ] 新增边界守卫测试：Stoa 正式代码和正式脚本不得依赖 `src/stoa/*`、`host-bridge`、`publish-context`、`state-summary`、`trace-turn`、`explain-recall`、`get-asset` 这类 patched surface。
- [ ] 这一任务只建立脱钩边界，不移动 submodule gitlink；真正 repin 放到 Task 8。

## Task 2: 删除 public memory inspection product surface

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/e2e/main-config-guard.test.ts`
- Modify: `src/renderer/app/App.test.ts`
- Modify: `src/renderer/components/AppShell.test.ts`
- Modify: `src/renderer/stores/settings.test.ts`
- Modify: `src/renderer/stores/update.test.ts`
- Modify: `src/renderer/stores/workspaces.test.ts`
- Modify: `src/renderer/components/settings/AboutSettings.test.ts`
- Modify: `src/renderer/components/settings/GeneralSettings.test.ts`
- Modify: `src/renderer/components/settings/ProvidersSettings.test.ts`

- [ ] 从 `RendererApi` 删除 `getMemoryStateSummary`、`traceMemoryTurn`、`explainMemoryRecall`、`getMemoryAsset`。
- [ ] 同步删除 `MemoryStateSummaryRequest`、`MemoryTurnTraceRequest`、`MemoryRecallExplanationRequest`、`MemoryAssetRequest` 这四个 request type。
- [ ] 删除 `IPC_CHANNELS.memoryGetStateSummary`、`memoryTraceTurn`、`memoryExplainRecall`、`memoryGetAsset` 及全部 main/preload handler。
- [ ] 清掉所有只为了满足这四个方法类型而存在的 renderer test mock 字段。
- [ ] `tests/e2e/main-config-guard.test.ts` 里与这四条 invoke contract、preload method、channel constant 相关的静态断言全部移除。
- [ ] 这一步只删 product surface；其下游 `runtime-host -> bridge -> client` 清理由 Task 3 负责，不在这里混用作用域。

## Task 3: 用 Stoa-owned engine adapter 取代 bridge / client / CLI protocol

**Files:**
- Create: `src/core/memory/evolver-engine-adapter.ts`
- Create: `src/core/memory/evolver-engine-adapter.test.ts`
- Delete: `src/core/memory/stoa-evolver-bridge.ts`
- Delete: `src/core/memory/stoa-evolver-bridge.test.ts`
- Delete: `src/core/memory/host-bridge-cli.test.ts`
- Delete: `src/core/memory/evolver-client.ts`
- Delete: `src/core/memory/evolver-client.test.ts`
- Delete: `src/core/memory/command-runner.ts`
- Delete: `src/core/memory/command-runner.test.ts`
- Modify: `src/core/memory/runtime-host.ts`
- Modify: `src/core/memory/runtime-host.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `scripts/run-real-first-round-experiment.ts`

- [ ] 新建 Stoa-owned `evolver-engine-adapter`，只允许依赖 raw upstream 模块，不允许回退到 patched CLI 协议。
- [ ] 先对下面这组现有动作做 inventory，标注每一项是 `keep` 还是 `delete`；只有能映射到 clean upstream 入口的子集才允许进入最终 adapter：
  - `warmStart`
  - `recall`
  - `observeWrite`
  - `processTurn`
  - `prepareReview`
  - `completeReview`
  - `prepareSolidify`
  - `completeSolidify`
  - `prepareDistill`
  - `completeDistill`
- [ ] 如果 inventory 证明某个动作在 raw upstream 上没有 clean 调用方式，直接删掉依赖它的 Stoa 行为，不在 Stoa 里模拟一个新的 `host-bridge` 协议。
- [ ] `src/main/index.ts` 在这里完成 host wiring 收口：把 `memoryRuntimeHost -> SessionEventBridge` 的注入从 `evolverBridge` 改成新的 adapter 命名；Task 2 只负责删它里面的 memory inspection handlers。
- [ ] `MemoryRuntimeHost` 不再暴露 `evolverBridge` 命名，统一改成 `engineAdapter` 或等价的宿主命名；`SessionEventBridge` 同步改成依赖 adapter interface，而不是“bridge”。
- [ ] `runtime-host.ts` 改为直接构造 adapter，不再先建 `EvolverClient`，也不再携带任何 `argsPrefix/command/env/runJsonCommand` 这类 CLI 形状。
- [ ] 新测试只验证 Stoa adapter 的宿主职责与 raw upstream 接线，不再验证 `host-bridge action name`、`publish-context`、`uv/pip capsule`。

## Task 4: 删除旧架构遗留的 memory 契约和死代码

**Files:**
- Modify: `src/shared/memory-runtime.ts`
- Delete: `src/core/memory/evolver-publish-context.test.ts`
- Delete: `src/core/memory/cli-ai-schemas.ts`
- Delete: `src/core/memory/evolver-input-materializer.ts`
- Delete: `src/core/memory/evolver-input-materializer.test.ts`
- Delete: `src/core/memory/worktree.ts`
- Delete: `src/core/memory/worktree.test.ts`

- [ ] 从 `src/shared/memory-runtime.ts` 移除只服务旧 run/publish/worktree/materializer 路径的类型：
  - `MemoryRunRecord`
  - `PublishedMemoryRecord`
  - `SemanticSessionSummary`
  - `ReviewDecision`
  - `DistillationResponse`
  - 以及仅为旧流程存在的辅助类型
- [ ] 保留并收紧真正仍在使用的宿主契约：
  - `ObservedEvent`
  - `EvidenceRef`
  - `DeliveryEnvelope`
  - `InferenceCapability`
  - `ExecutionCapability`
  - `RuntimeJobRecord`
  - `ProcessTurnResult`
- [ ] 删除所有只为旧 publish/worktree/materializer 路径存在、当前没有生产调用方的模块与测试。
- [ ] 删除任何把 upstream `publishContext` 当正式契约的测试与注释性实现。

## Task 5: 把 inference support matrix 收缩到真实支持面

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/core/project-session-manager.test.ts`
- Modify: `src/core/memory/inference-router.ts`
- Modify: `src/core/memory/inference-router.test.ts`
- Modify: `src/core/memory/runtime-capabilities.ts`
- Modify: `src/core/memory/runtime-capabilities.test.ts`
- Modify: `src/core/memory/runtime-host.ts`
- Modify: `src/core/memory/runtime-host.test.ts`
- Modify: `src/renderer/stores/settings.ts`
- Modify: `src/renderer/stores/settings.test.ts`
- Modify: `src/renderer/components/settings/ProvidersSettings.vue`
- Modify: `src/renderer/components/settings/ProvidersSettings.test.ts`

- [ ] `EvolverInferenceProvider` 直接收缩到当前真实支持值，不再保留 `codex` / `api` 这种假选项。
- [ ] `project-session-manager.ts` 与 `settings.ts` 的 normalize / persist / hydrate / update 逻辑同步收紧，只接受新的真实支持值。
- [ ] `InferenceRouter` 的 factory record 与测试同步收缩；不再为了类型完整性保留未实现 provider。
- [ ] `runtime-host.ts` 不再通过“resolve 失败则 recall-only”来掩盖未实现 provider；recall-only 只用于真实支持 provider 缺可执行路径这类宿主可恢复问题。
- [ ] 设置页只显示当前真实受支持的 inference provider，并同步更新对应文案和测试。

## Task 6: 保留 TurnMaintenanceRunner，但只针对 adapter 抽象编排

**Files:**
- Modify: `src/core/memory/turn-maintenance-runner.ts`
- Modify: `src/core/memory/turn-maintenance-runner.test.ts`

- [ ] `TurnMaintenanceRunner` 继续承担宿主编排职责，但链路只覆盖 Task 3 inventory 判定为 `keep` 的 maintenance phases。
- [ ] 默认编排顺序仍是 `processTurn` 之后串联 `review -> solidify -> distill`；如果其中某一段在 Task 3 被判定删除，runner 和测试都要显式收缩到 surviving phases，而不是保留空壳。
- [ ] runner 只依赖 Stoa adapter 抽象，不知道 upstream `src/stoa/*` 文件结构，也不假设历史 bridge 产物格式。
- [ ] `turn-maintenance-runner.ts` 不再 import `evolver-client` 类型；相关 option/type 定义改到 Stoa 自己的 adapter 层或 shared 宿主层。
- [ ] runner 测试只覆盖：
  - 何时请求推理
  - 何时请求执行
  - phase failure 如何传播
  - 无可用 capability 时如何跳过

## Task 7: 收紧 SessionEventBridge 到 provider hook protocol 最小面

**Files:**
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `scripts/run-real-first-round-experiment.ts`

- [ ] 保留现有宿主主链：
  - `SessionStart -> warmStart`
  - `UserPromptSubmit -> recall`
  - `PostToolUse(Write) -> observeWrite`
  - `Stop/StopFailure -> finalizeTurn`
- [ ] 这条链只表达 provider hook protocol，不表达 memory engine 内部逻辑。
- [ ] 删除任何为了 memory inspection API、patched bridge、旧命名 `evolverBridge` 而存在的注入点和测试分支。
- [ ] 如果实验需要观察 recall / warmStart 是否真的注入内容，只允许增加 Stoa 本地 observer callback 这类非产品面 telemetry；不允许恢复 IPC / preload / turn-record inspection API。
- [ ] provider-specific 测试保留最小矩阵，只验证协议必须行为，不再验证历史 patched 行为。

## Task 8: 本地脱钩完成后再 repin bundled Evolver 到 clean upstream

**Files:**
- Modify: `research/upstreams/evolver` (gitlink only)
- Modify: `src/core/memory/bundled-evolver.test.ts`

- [ ] 只有在 Task 1-7 完成、Stoa 已不再 import / require patched surface 之后，才移动 submodule gitlink。
- [ ] 当前本地证据显示 `d4c2271` 和 `413713a` 是 Stoa-patched，`bc17fda` 之前不含 `src/stoa/*`；实施时从 clean upstream ref 中选择一个可工作的目标提交。
- [ ] repin 后再次确认 git tree 不含 `src/stoa/*`、`test/stoa*` 这类 patched 目录。
- [ ] `bundled-evolver.test.ts` 同步断言新的 raw upstream 边界，不再断言 CLI entrypoint 形状。

## Task 9: 删除或重写错误历史文档，防止旧边界继续回流

**Files:**
- Delete: `docs/superpowers/plans/2026-04-26-entire-evolver-memory-bridge.md`
- Delete: `docs/superpowers/plans/2026-04-27-full-evolver-integration-cli-ai-provider.md`
- Delete: `docs/superpowers/plans/2026-04-28-stoa-evolver-host-orchestrator.md`
- Delete: `docs/superpowers/plans/2026-04-29-stoa-evolver-runtime-host-implementation.md`
- Delete: `docs/superpowers/specs/2026-04-25-entire-evolver-direct-integration-design.md`
- Delete: `docs/superpowers/specs/2026-04-26-entire-evolver-memory-self-evolution-design.md`
- Delete: `docs/superpowers/specs/2026-04-27-memory-plugin-architecture-design.md`
- Delete: `docs/superpowers/specs/2026-04-28-stoa-evolver-host-orchestrator-design.md`
- Delete: `docs/superpowers/specs/2026-04-29-stoa-evolver-runtime-host-design.md`
- Modify: `docs/engineering/evolver-data-flow.md`
- Modify: `docs/engineering/evolver-integration-gap-analysis.md`
- Modify: `research/2026-04-27-evolver-real-source-integration.md`
- Modify: `research/2026-04-28-evolver-native-hooks-and-bridge-necessity.md`
- Modify: `research/2026-04-28-evolver-memory-model-and-retrieval.md`
- Modify: `research/2026-04-28-real-llm-e2e-and-trigger-timing.md`
- Modify: `research/2026-04-28-task-7-direct-memory-migration.md`
- Modify: `research/2026-04-29-distill-trigger-and-recall-failure.md`
- Modify: `research/2026-04-29-evolver-distill-validation-dependencies.md`
- Modify: `research/2026-04-29-evolver-runtime-host-current-state.md`
- Modify: `research/2026-04-29-evolver-recall-exit-analysis.md`
- Modify: `research/2026-04-29-evolver-capsule-real-execution.md`
- Modify: `research/2026-04-29-real-memory-e2e-evidence.md`
- Modify: `research/2026-04-29-stoa-evolver-current-integration.md`
- Create: `research/2026-04-30-evolver-upstream-hardcoding-inventory.md`

- [ ] 删除那些把“往 upstream 写 `src/stoa/*`”当成推荐实现路线的旧 plans/specs；不做保留式兼容说明。
- [ ] `docs/superpowers/specs/2026-04-25-entire-evolver-direct-integration-design.md` 也一起删除，因为它仍然写着 “small upstream modifications are acceptable”，和当前硬边界规则正面冲突。
- [ ] `docs/engineering/evolver-data-flow.md` 改成新的边界定义：
  - Stoa = host + adapter + evidence/runtime orchestration
  - Evolver = raw third-party engine dependency
- [ ] `docs/engineering/evolver-integration-gap-analysis.md` 与相关研究文档同步改口，避免继续把 patched bridge 当作“可接受但暂未清理”的官方路线。
- [ ] 研究文档保留调查价值，但必须明确：
  - 旧 patched flow 已废弃
  - `host-bridge` / `publish-context` / `uv-pip capsule` 不是当前 Stoa 契约
- [ ] inventory 文档只做事实记录，不写新的产品承诺。

## Task 10: 重写真实实验，换掉 `uv/pip` 污染案例

**Files:**
- Modify: `scripts/run-real-first-round-experiment.ts`

- [ ] 把实验主题从 Python 包管理偏好改成 repo-real、但不易被通用先验命中的“memory runtime 改动前的快速定向验证命令偏好”。
- [ ] temp repo seed 不再是 Python toy repo，改成小型 Node/Vitest 结构，并且要刻意镜像这条隐藏规则会引用到的相对路径：
  - `src/core/memory/runtime-host.test.ts`
  - `src/core/memory/turn-maintenance-runner.test.ts`
  - `src/main/session-event-bridge.test.ts`
  - 以及最小可运行的 `package.json` / `vitest.config.ts`
- [ ] 这样隐藏规则里的精确命令才是“符合仓库结构的自然选择”，而不是对一个无关 temp repo 的外来字符串。
- [ ] 推荐隐藏规则改成精确命令：
  - `npx vitest run src/core/memory/runtime-host.test.ts src/core/memory/turn-maintenance-runner.test.ts src/main/session-event-bridge.test.ts`
- [ ] prompt 必须继续显式禁止 inspect repo / hidden folders；否则一旦 temp repo 里出现这些测试文件，模型可以靠 repo 结构而不是记忆推导答案。
- [ ] session1 只被口头告知这条规则，session2 在没有额外提示时回答同类问题；两边都只允许写答案到文件，不允许真正执行命令。
- [ ] 实验不再调用已删除的 memory inspection API。
- [ ] memory-on 场景的中间观测只来自 Stoa 本地仍保留的可观测点：
  - `RuntimeStateStore` 的 `sealedTurns`
  - `RuntimeStateStore` 的 `jobs`
  - `SessionEvidenceStore` 已落盘的 turn seal / evidence metadata / snapshot
  - `createMemoryRuntimeHost({ onTurnPhaseEvent })` 收到的 phase events
  - `SessionEventBridge` 本地 observer 记录到的 recall / warmStart delivery 结果
  - 实验脚本直接写出的 answer 文件
- [ ] 如果 `jobs + onTurnPhaseEvent` 仍不足以区分 surviving maintenance phases 的失败点，只允许补最小的 Stoa 本地 observer payload；不允许恢复 `traceTurn` 或 turn record 文件。
- [ ] 实验结论不能只看 session2 最终答案；必须同时给出链路状态：
  - 是否 sealed turn
  - 是否进入 `processTurn`
  - Task 3 inventory 最终保留了哪些 maintenance phases
  - 对保留下来的 phases，链路到了哪一步
  - 失败停在何处

## Task 11: 验证和收尾

**Files:**
- Modify any affected tests or behavior assets required by the repository gate.

- [ ] 先跑定向检查：
  - `git -C research/upstreams/evolver rev-parse HEAD`
  - `powershell -NoProfile -Command "$paths = git -C research/upstreams/evolver ls-tree -r --name-only HEAD; if ($paths | Select-String '^src/stoa/|^test/stoa') { $paths | Select-String '^src/stoa/|^test/stoa'; exit 1 }"`
  - `powershell -NoProfile -Command "$out = rg -n \"research/upstreams/evolver/src/stoa/|host-bridge|publish-context|state-summary|trace-turn|explain-recall|get-asset\" src tests scripts; if ($LASTEXITCODE -eq 0) { $out; exit 1 } elseif ($LASTEXITCODE -gt 1) { exit $LASTEXITCODE }"`
  - `npm run typecheck`
  - `npx vitest run src/core/memory/evolver-engine-adapter.test.ts src/core/memory/runtime-host.test.ts src/core/memory/turn-maintenance-runner.test.ts src/main/session-event-bridge.test.ts`
  - `npx vitest run src/core/project-session-manager.test.ts src/renderer/stores/settings.test.ts src/renderer/components/settings/ProvidersSettings.test.ts`
  - `tsx --tsconfig tsconfig.node.json scripts/run-real-first-round-experiment.ts`
- [ ] 再跑完整质量门禁：
  - `npm run test:generate`
  - `npx vitest run`
  - `npm run test:e2e`
  - `npm run test:behavior-coverage`
- [ ] 完整验证通过前，不宣称清理完成。
- [ ] 如果实验脚本失败，报告先列出 Task 3 inventory 最终保留了哪些 phases，再明确失败落点是：
  - recall 前没有 sealed turn
  - `processTurn` 未触发
  - 某个保留下来的 maintenance phase 失败
  - recall 未命中

## Acceptance Criteria

- `research/upstreams/evolver/**` 回到 clean upstream，Stoa 不再在 submodule 内保留任何自定义代码。
- Stoa 正式代码、正式测试、正式脚本对 `src/stoa/*`、`host-bridge`、`publish-context`、memory inspection CLI action 的依赖为零。
- `RendererApi` product surface 中不再存在 `getMemoryStateSummary`、`traceMemoryTurn`、`explainMemoryRecall`、`getMemoryAsset`。
- `resolveBundledEvolverCli`、`evolverBridge` 这类旧边界命名在 Stoa 内消失，改为 Stoa-owned adapter 边界。
- `src/core/memory/evolver-client.ts`、`command-runner.ts`、`stoa-evolver-bridge.ts` 及相关测试已删除。
- `src/shared/memory-runtime.ts` 不再承载旧 run/publish/worktree/materializer 契约。
- Evolver inference provider 设置面和运行时真实支持矩阵一致，不再保留假选项。
- 真实实验不再使用 `uv/pip`，也不依赖工作区污染副作用来证明记忆生效。
- 实验报告会明确展示 surviving maintenance phases，以及链路具体停在何处。
- 仓库质量门禁全部通过。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-stoa-evolver-hardcoding-cleanup.md`.

Two execution options:

1. Subagent-Driven
每个任务单独派工并逐任务 review，适合这次“删旧边界 + 收缩真实支持面”的强约束清理。

2. Inline Execution
直接在当前会话按任务顺序实现，适合持续盯住 Stoa / upstream 边界，不让执行过程中再长出兼容层。
