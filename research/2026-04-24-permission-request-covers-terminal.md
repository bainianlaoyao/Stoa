---
date: 2026-04-24
topic: PermissionRequest covering main terminal
status: completed
mode: context-gathering
sources: 8
---

## Context Report: PermissionRequest 覆盖主终端

### Why This Was Gathered
用户报告请求权限时整个主终端被 PermissionRequest 状态覆盖，导致终端无法使用。需确认根因和涉及的文件范围。

### Summary
当 Claude Code 触发 `PermissionRequest` hook 时，后端正确将其适配为 `needs_confirmation` 状态并推送至渲染进程。但 `TerminalViewport.vue` 的 `LIVE_TERMINAL_STATUSES` 集合中**不包含 `needs_confirmation`**，导致 xterm 终端被销毁，整个终端区域被替换为静态的会话详情卡片。

### Key Findings

- **根因**: `LIVE_TERMINAL_STATUSES` 缺少 `needs_confirmation` — `TerminalViewport.vue:17`
- 当 `isLiveTerminal` 为 false 时，watcher (行 210-218) 会调用 `disposeTerminal()` 销毁 xterm 实例
- 模板使用 `v-if="isLiveTerminal"` / `v-else` 互斥渲染，live terminal 和 overlay 不会同时存在
- 没有专门的 PermissionRequest UI 组件（无 PermissionRequest.vue / ConfirmDialog.vue）
- `WorkspaceHierarchyPanel.vue:342-370` 的状态点样式也缺少 `needs_confirmation` 的颜色规则

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `LIVE_TERMINAL_STATUSES` 不含 `needs_confirmation` | `TerminalViewport.vue` | `:17` |
| watcher 在状态变化时销毁终端 | `TerminalViewport.vue` | `:210-218` |
| `v-if/v-else` 互斥渲染 overlay | `TerminalViewport.vue` | `:232-271` |
| Hook 事件适配映射 | `hook-event-adapter.ts` | `:17-21` |
| Claude Code hook 配置 | `claude-code-provider.ts` | `:57-74` |
| 会话状态推送 IPC | `session-runtime-controller.ts` | `:49-57, 73-77` |
| 状态点 CSS 缺少 `needs_confirmation` | `WorkspaceHierarchyPanel.vue` | `:342-370` |

### 修复范围

| 文件 | 行 | 需要变更 |
|------|-----|---------|
| `src/renderer/components/TerminalViewport.vue` | 17 | 将 `'needs_confirmation'` 加入 `LIVE_TERMINAL_STATUSES` |
| `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | 361-364 | 添加 `.route-dot.needs_confirmation` CSS 规则 |
| `src/renderer/components/TerminalViewport.test.ts` | — | 添加 `needs_confirmation` 状态渲染 live terminal 的测试 |

### Risks / Unknowns

- [!] 加入 `needs_confirmation` 后，用户在权限确认期间仍能看到终端输出，但可能需要在 xterm 上叠加一层半透明提示（当前无此设计）
- [?] `needs_confirmation` 状态下是否需要禁用终端输入（xterm 可能仍然接受键盘输入）— 需确认 Claude Code CLI 此时是否接受 stdin
- [?] 是否需要为 `needs_confirmation` 状态添加专属 UI 提示（如横幅提示用户去 CLI 确认权限）
