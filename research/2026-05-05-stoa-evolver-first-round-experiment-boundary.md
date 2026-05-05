---
date: 2026-05-05
topic: stoa x evolver first-round experiment boundary
status: active
scope: current-stoa-boundary
---

# Stoa x Evolver 一轮实验边界更新

## 1. 为什么现在必须更新实验口径

`f637635 Restore upstream Evolver lifecycle integration` 之后，Stoa 已不再只是 Claude hook recent-recall 接线。

当前运行时已经会在 `Stop` 后走真实的：

- `stageTurn`
- `solidify`
- `prepareDistill`
- `completeDistill`

对应代码在：

- [src/core/memory/evolver-engine-adapter.ts](D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-engine-adapter.ts)
- [src/core/memory/turn-maintenance-runner.ts](D:/Data/DEV/ultra_simple_panel/src/core/memory/turn-maintenance-runner.ts)
- [src/main/session-event-bridge.ts](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts)

因此，旧的“只证明 recent recall 就算整体成功”的实验解释已经不够用了。

## 2. `experiment:first-round` 现在应该证明什么

这套实验现在是一个分层证明，而不是单一结论。

### A. Recall path

这部分仍然由三段组成：

- `control`
- `incidentHandoff`
- `visibilityProbe`

它证明的是：

- session-start recall 真的被注入
- recall 真的改变了后续判断
- 结果不是工作区线索或运行时再搜索造成的

### B. Solidify path

`incident-session1` 不再只是“写入一条 recent memory”。

它同时必须证明：

- `Stop` 事件触发 sealed turn
- `TurnMaintenanceRunner` 真的被排队执行
- job 最终完成，而不是只停在 queued/running
- 真实 `solidify` 被观察到并成功结束

### C. Distill path

当前 `first-round` 场景不把 distill 当硬门槛。

原因不是我们不想验证，而是这套场景本身并没有刻意满足 upstream 的 distill 触发条件，例如：

- `solidify_count` 达到 auto-distill 阈值
- failure-distill 前提满足
- 其它 upstream threshold / idle-window 条件满足

所以在这套实验里：

- `distill observed` 是观察项
- 不是通过项

## 3. 当前脚本的解释规则

当前脚本应按下面四个字段解释：

- `recallPathAligned`
- `solidifyPathAligned`
- `distillRequiredByScenario`
- `distillObservedInScenario`

解释方式：

- `recallPathAligned=true`：recent recall 这条路径成立
- `solidifyPathAligned=true`：真实 stop-triggered solidify 路径成立
- `distillRequiredByScenario=false`：这一轮实验没有资格把“未出现 distill”直接算失败
- `distillObservedInScenario=true`：尽管不是硬门槛，但本轮仍然实际观察到了 distill

`overallAligned` 在当前脚本里应只表示：

- recall path 成立
- solidify path 成立

而不是“full distill lifecycle 已经被这套场景完整证明”。

## 4. 这次更新后的结论边界

`experiment:first-round` 现在的准确含义是：

> 第一轮真实实验同时验证 recall path 和 stop-triggered solidify path；distill 只作为观察项，不作为这一轮场景的硬门槛。

如果要证明更强的声明，例如：

- distill 一定被触发
- distill 产物而不是 recent recall 改变了后续行为
- 多 session 的知识更新来自 distilled gene / capsule

那需要单独的、专门针对 distill trigger 设计的新实验，而不是继续复用当前这套 handoff 场景。
