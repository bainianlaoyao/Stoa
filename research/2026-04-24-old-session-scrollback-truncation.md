---
date: 2026-04-24
topic: old session scrollback truncation root cause
status: completed
mode: context-gathering
sources: 4
---

## Context Report: 旧会话无法回滚/输出截断

### Why This Was Gathered
用户报告切换到旧会话时终端内容被截断、无法向上滚动查看历史。已确认数据层正常（CLI resume 输出完整对话），定位为显示层问题。

### Summary
根因是 **xterm `scrollback: 10_000` 行太小**。CLI resume 时一次性输出完整对话历史（含工具输出、代码块等），轻易超过 10,000 行。超出部分被 xterm 从 scrollback buffer 驱逐，用户只能回滚到最后 10,000 行。

### Key Findings

1. **xterm scrollback 限制为 10,000 行**
   - `xterm-runtime.ts:154`：`scrollback: 10_000`
   - Claude Code 完整对话历史（含工具输出、代码块、思考过程）通常上万行
   - 超出 scrollback 的最早行被 xterm 驱逐，不可恢复

2. **WebGL addon 可能加剧问题**
   - `xterm-runtime.ts:177-193`：WebGL addon 启用（`canUseWebgl()` 返回 true 时）
   - WebGL 渲染在大 scrollback buffer 下可能有性能/渲染问题
   - 如果增大 scrollback，需验证 WebGL 渲染是否稳定

3. **数据写入链路无问题**
   - `enqueueWrite` 顺序链式写入，等待 `fitSettled` 后 `writeChunk`
   - `writeChunk` 使用 `terminal.write(data, callback)` 正确异步写入
   - IPC 和 PTY 数据流均正常

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| scrollback 10K 行 | xterm-runtime.ts | :154 |
| WebGL addon 启用 | xterm-runtime.ts | :177-193 |
| 写入链路正常 | TerminalViewport.vue | :101-112 |
| fitSettled gate | TerminalViewport.vue | :85-87, 109 |

### Risks / Unknowns

- [!] **scrollback 增大后的内存影响**：100K 行 scrollback 在 xterm 中约额外消耗 50-100MB 内存，需权衡
- [?] **WebGL 渲染稳定性**：大 scrollback 下 WebGL addon 是否有已知 bug，需在目标环境测试
