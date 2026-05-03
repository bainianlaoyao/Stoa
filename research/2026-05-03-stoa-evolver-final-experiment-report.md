---
date: 2026-05-03
topic: stoa x evolver final experiment report
status: completed
scope: current-stoa-boundary
---

# Stoa x Evolver 最终实验报告

## 1. 报告范围

本报告只覆盖当前 `main` 工作树里已经真实接入、且能被真实运行验证的能力。

结论边界如下：

- 已验证：Stoa 对 Claude Code 的 hook-level Evolver 接入。
- 已验证：`SessionStart` 的 recent recall 注入。
- 已验证：`Stop` 的 recent outcome 记录到 `memory_graph.jsonl`。
- 已验证：跨 session 的失败模式避免行为。
- 未验证也不能声称已验证：upstream `evolve.run` 主循环、GEP prompt 生成、full distill lifecycle、validated gene generation、host-managed autonomous evolution。

这不是保守措辞，而是由当前产品接线决定的事实。

## 2. 当前产品实际接线

当前 Stoa 的 Claude 侧接线是：

- provider 启动时安装 Claude hook wrapper：`src/extensions/providers/claude-code-provider.ts`
- wrapper 调 upstream Claude hook scripts，并把其结果转成 Claude 可接受的 `additionalContext`：`src/extensions/providers/evolver-hook-sidecar.ts`
- main process 只接收 provider hook 事件和 memory notification，并更新 session 状态、透传 toast：`src/main/session-event-bridge.ts`

关键代码点：

- `src/extensions/providers/claude-code-provider.ts:59`
- `src/extensions/providers/evolver-hook-sidecar.ts:61`
- `src/extensions/providers/evolver-hook-sidecar.ts:349`
- `src/extensions/providers/evolver-hook-sidecar.ts:421`
- `src/extensions/providers/evolver-hook-sidecar.ts:475`
- `src/extensions/providers/evolver-hook-sidecar.ts:518`
- `src/main/session-event-bridge.ts:65`
- `src/main/session-event-bridge.ts:72`
- `src/main/session-event-bridge.ts:98`
- `src/main/session-event-bridge.ts:100`

反证同样重要：当前 `src/` 和 `scripts/` 下没有任何 Stoa 运行时代码直接调用 upstream 的 full lifecycle 入口。

最新检查结果：

- 在 `src/` 和 `scripts/` 下搜索 `evolve.run`
- 搜索 `prepareDistillation`
- 搜索 `completeDistillation`
- 搜索 `shouldDistill`
- 搜索 `autoDistillFromFailures`
- 搜索 `buildGepPrompt`
- 搜索 `selectGeneAndCapsule`

结果：`NO_HITS`

这说明当前产品不是 full Evolver lifecycle integration，而是 hook-level recent memory integration。

## 3. 实验设计

本次最终实验采用当前产品边界下最强、且最不依赖工作区伪线索的三段式设计，脚本在：

- `scripts/run-real-first-round-experiment.ts`
- `scripts/run-real-first-round-experiment-entry.ts`

脚本包含三组真实场景：

1. `control`
   - 没有 recent failed outcome
   - 只让 Claude 在 session 开始时根据已有上下文做决策
   - 预期选择继续默认 quick patch pattern

2. `incidentHandoff`
   - Session 1 做一个很小但带失败信号的改动
   - `Stop` 后由 upstream hook 写入 recent failed outcome
   - Session 2 在 fresh workspace 下收到同类决策题
   - 预期停止重复 quick patch pattern

3. `visibilityProbe`
   - 预先向 `memory_graph.jsonl` 写入一个 `SESSION_START_SENTINEL=...`
   - 禁止 Claude 使用任何工具
   - 只允许它根据 session start 已拿到的上下文回显 sentinel
   - 用于证伪“它只是靠工作区文件自己看出来的”

脚本中的关键入口：

- `scripts/run-real-first-round-experiment.ts:162`
- `scripts/run-real-first-round-experiment.ts:167`
- `scripts/run-real-first-round-experiment.ts:172`

## 4. 最新真实运行

2026-05-03 最新一次完整运行命令：

```bash
npm run experiment:first-round
```

最新产物目录：

- `.tmp/stoa-evolver-exp-OhudB8/`

最新总报告：

- `.tmp/stoa-evolver-exp-OhudB8/experiment-report.json`

关键字段：

- `baseDir`: `.tmp/stoa-evolver-exp-OhudB8/experiment-report.json:4`
- `controlChoice: "A"`: `.tmp/stoa-evolver-exp-OhudB8/experiment-report.json:451`
- `incidentChoice: "B"`: `.tmp/stoa-evolver-exp-OhudB8/experiment-report.json:452`
- `memoryGenerated: true`: `.tmp/stoa-evolver-exp-OhudB8/experiment-report.json:456`
- `recallDelivered: true`: `.tmp/stoa-evolver-exp-OhudB8/experiment-report.json:457`
- `visibilityProbeObservedSentinel: true`: `.tmp/stoa-evolver-exp-OhudB8/experiment-report.json:460`
- `overallAligned: true`: `.tmp/stoa-evolver-exp-OhudB8/experiment-report.json:467`

## 5. 实验结果

### 5.1 Control

`control` 中没有 recent failed outcome。

Claude 的回答是：

- `Choice: A`
- 继续默认 quick patch pattern

这符合基线预期，说明没有“凭空保守化”。

### 5.2 Incident Handoff

Session 1 做了一个 very small one-file patch，只改：

- `src/billingLookup.ts`

该 run 结束后，memory graph 中真实出现：

- `status: failed`
- `score: 0.3`
- `signals: ["log_error", "perf_bottleneck"]`

随后 Session 2 在 fresh workspace 中收到同一个“是否继续 quick patch pattern”的问题，Claude 回答：

- `Choice: B`
- 理由明确引用了最近一次失败结果和失败信号

这证明：

- recent failed outcome 确实被写入了 Evolver recent memory
- 下一次 session 确实收到了 recall
- recall 对行为产生了可观察影响

### 5.3 Visibility Probe

`visibilityProbe` 中，脚本预写入 sentinel：

- `SESSION_START_SENTINEL=STOA-EVOLVER-EXP-OHUDB8_0341B9C52405472398E3861CFCEDB919`

并且显式禁止工具调用。

Claude 最终原样回显了这个 token。

这证明：

- session-start 注入确实进入了模型可见上下文
- 结果不是靠再次读工作区文件、再跑命令、再看 transcript 得出的

## 6. 这次实验真正证明了什么

在当前 Stoa 边界上，已经被真实证明的结论是：

1. Claude Code 启动时，Stoa 的 wrapper 能成功调用 upstream `evolver-session-start`，并把其输出变成 Claude 可消费的 `additionalContext`。
2. Claude Code 结束时，Stoa 的 wrapper 能成功调用 upstream `evolver-session-end`，并把 recent outcome 写入 `memory_graph.jsonl`。
3. 这些 recent memory 可以跨 session 生效。
4. 这种跨 session 生效不是工作区伪线索，不是工具读文件，不是 transcript 泄漏，而是 session-start recall 注入本身。
5. 在 failure-oriented 场景下，当前 integration 已经能支持“避免重复最近刚失败的模式”这一类 Evolver 风格能力。

## 7. 这次实验没有证明什么

这次不能声称已经证明以下能力：

1. Stoa 已经接入 upstream `evolve.run` 主循环。
2. Stoa 已经接入 upstream full distill lifecycle。
3. 当前 Claude 产品流里已经会自动触发 `prepareDistillation -> LLM distill -> completeDistillation`。
4. 当前 Claude 产品流里已经会自动生成并回收 upstream Gene / Capsule 资产。
5. 当前实验结果来自 full GEP asset evolution，而不是 recent memory graph recall。

原因不是“我们没想到实验”，而是当前产品接线没有这些调用面。

## 8. 支撑验证

为避免只依赖实验脚本，本次还做了当前工作树上的定向测试验证。

运行命令：

```bash
npx vitest run src/extensions/providers/claude-code-provider.test.ts src/main/session-event-bridge.test.ts src/core/hook-event-adapter.test.ts
```

结果：

- 3 个测试文件通过
- 52 个测试通过

这些测试覆盖的关键点包括：

- Claude hook wrapper 能真实包装 upstream hooks
- `SessionStart` recall 能返回 upstream 输出并通知 Stoa
- `Stop` solidify 路径能写 recent outcome
- memory notification IPC 生产链仍然存在
- hook payload 到 canonical session event 的适配仍然正确

## 9. 最终结论

截至 2026-05-03，Stoa x Evolver 在当前产品边界上的最终实验结论是：

- 当前接入已经真实可用。
- 但它是 hook-level recent recall integration，不是 full Evolver lifecycle integration。
- 在这个边界上，实验已经充分证明 recent failure memory 能跨 session 改变 Claude 的后续决策，并且这种影响来自 recall 注入本身。
- 因此，当前可以对外准确表述为：

> Stoa 已经正确集成了 Evolver 的 Claude hook recent-memory path，并已通过真实实验验证：recent failed outcomes 会在后续 session 中被 recall，并影响 Claude 避免重复最近刚失败的 quick patch pattern。

如果以后要验证更强的承诺，例如 gene distillation、validated evolution asset、full GEP lifecycle，那么前提不是继续改实验，而是先把相应 upstream 生命周期真实接到 Stoa 运行时里。
