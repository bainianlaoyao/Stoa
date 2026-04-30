---
date: 2026-04-30
topic: evolver stoa bridge reasonability
status: completed
mode: context-gathering
sources: 5
---

## Context Report: Evolver Stoa Bridge Reasonability

### Why This Was Gathered
判断 `research/upstreams/evolver/src/stoa/*` 这层桥接代码放在 upstream 里是否合理，以及“不合理”具体不合理在什么地方。

### Summary
“上游引擎里存在一个宿主桥接层”这件事本身不奇怪，如果它只是把宿主输入输出适配到引擎核心能力上，那可以视为 first-party host adapter。问题在于当前这层并不薄，它不仅暴露命令入口，还直接承担了 Stoa 的 turn record 持久化、review/solidify/distill 分阶段状态管理、target-specific publish policy，甚至包含主题级 `uv/pip` 记忆提取规则，因此已经从“适配层”滑向了“把宿主产品逻辑写进引擎”。

### Key Findings
- upstream 明确把 `host-bridge`、`publish-context`、`distill` 接口挂到 CLI 上，并且都指向 `src/stoa/*`，说明作者确实想在 Evolver 仓库内部维护一套 Stoa integration surface。
- `hostBridge.js` 并不只是转发请求。它自己维护 `stoa-bridge-turns` 目录、生成 turn key、写 turn record，这已经是宿主流程编排状态，不是纯引擎能力。
- `handleProcessTurn()` 里直接做了 evidence 解析、signal 归纳、capsule 持久化和本地 trace record 写入；其中 `extractPreferenceCapsules()` 还硬编码了 `uv/pip` 偏好提取。
- `handlePrepareReview/CompleteReview/PrepareSolidify/PrepareDistill` 这组函数把 review、solidify、distill 的分阶段状态机也塞进了 bridge file，进一步说明这不是薄适配层，而是桥接编排器。
- `publishContext.js` 根据 `claude-code`、`codex`、`generic` 分 target 决定 selection policy 和内容格式，这说明上游已经承担了 consumer-facing delivery policy，而不是只输出中性 memory result。
- 相比之下，`distillBridge.js` 这种“把 `skillDistiller` 的 prepare/complete 包成稳定载荷”的层次是相对合理的，因为它主要是 API 整形，而不是引入额外宿主业务。
- `reviewBridge.js` 的 `rejectReview()` 甚至直接执行 `git checkout -- .` 和 `git clean -fd ...`，这类副作用属于具体宿主工作流决策，放在上游 bridge 里耦合很重。

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| upstream 暴露 `publish-context` 与 `host-bridge` CLI 接口 | `research/upstreams/evolver/index.js` | [623-647](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/index.js:623) |
| bridge 自己维护 `stoa-bridge-turns` turn record | `research/upstreams/evolver/src/stoa/hostBridge.js` | [63-83](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:63) |
| bridge 硬编码 `uv/pip` capsule 提取 | `research/upstreams/evolver/src/stoa/hostBridge.js` | [263-300](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:263) |
| bridge 负责 `processTurn` 与 review/solidify/distill 分阶段状态 | `research/upstreams/evolver/src/stoa/hostBridge.js` | [601-679](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:601), [684-818](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:684) |
| bridge 作为统一 action multiplexer | `research/upstreams/evolver/src/stoa/hostBridge.js` | [990-1032](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:990) |
| publish 层按 consumer target 分策略 | `research/upstreams/evolver/src/stoa/publishContext.js` | [11-18](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/publishContext.js:11), [70-84](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/publishContext.js:70), [128-149](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/publishContext.js:128) |
| review bridge 直接做 git reset/clean 风格回滚 | `research/upstreams/evolver/src/stoa/reviewBridge.js` | [128-157](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/reviewBridge.js:128) |
| distill bridge 主要做 payload 包装，耦合较轻 | `research/upstreams/evolver/src/stoa/distillBridge.js` | [8-27](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/distillBridge.js:8), [42-60](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/distillBridge.js:42) |

### Risks / Unknowns
- [!] 如果 upstream 作者本来就把 Evolver 定位为 “memory engine + 官方 Stoa adapter”，那 `src/stoa/` 目录的存在本身未必违背他们的产品边界；真正有问题的是桥接层过厚。
- [!] 只从当前代码看，不足以证明未来 upstream 不会再抽象出 `src/host/` 之类更中性的接口。
- [?] 当前 `src/stoa/*` 是否只是实验性目录，还是上游正式支持面，需要结合 upstream 文档或提交讨论再确认。

## Context Handoff: Evolver Stoa Bridge Reasonability

Start here: `research/2026-04-30-evolver-stoa-bridge-reasonability.md`

Context only. Use the saved report as the source of truth.
