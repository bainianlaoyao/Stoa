# Memory

## Recent Session Evidence

### User Requests
- 现在如何触发一遍stoa管理的全部工作去的hook重装?

### Assistant Outcomes
- 现在没有单独的“一键重装全部 hooks”入口。当前实际触发点是 session runtime 启动时统一执行 `provider.installSidecar(...)`，见 [session-runtime.ts](D:/Data/DEV/ultra_simple_panel/src/core/session-runtime.ts:72)。 所以，当前能触发重装的方式只有这几种： - 新建 session：`session:create` 后会启动 runtime，从而重装该 session 对应工作区的 hook/sidecar，见 [index.ts](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:882) - 恢复 archived session：`session:restore` 后会再次启动 runtime，从而重装，见 [index.ts](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:1058) - 重启 Stoa：启动时会遍历 bootstrap recovery plan，对所有 `!archived` 的 session 自动拉起 runtime，因此会批量重装这些 session 对应工作区的 hook/sidecar，见 [index.ts](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:1112) 和 [project-session-manager.ts](D:/Data/DEV/ultra_simple_panel/src/core/project-session-manager.ts:277) 几个边界要说清楚： - 这不是“按工作区”重装，而是“按 session”触发。某个工作区如果没有 Claude/Codex/OpenCode session，就不会被扫到。 - `shell` session 不会装任何 sidecar，它的 `installSidecar` 是 no-op，见 [local-shell-provider.ts](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/local-shell-provider.ts:35)。 - 已经 `archived` 的 session 不会在应用启动时自动参与这轮批量重装。 所以如果你要“现在立刻把 Stoa 当前管理到的活跃工作区都重装一遍 hook”，当前最接近的操作就是： 1. 确保这些工作区各自至少有一个未归档的 `claude-code` / `codex` / `opencode` session。 2. 完全重启一次 Stoa。 这样会把这些 session 对应的 sidecar/hook 按当前代码重新写入一遍。还没有一个专门的“批量重装全部 hooks”按钮或 IPC 入口。若你要，我下一步可以直接补一个专用的 bulk refresh 入口。

### Turn Events
- codex.UserPromptSubmit
- codex.Stop

### Transcript Snippets
- {"timestamp":"2026-04-29T14:54:25.997Z","type":"session_meta","payload":{"id":"019dd9bb-3fa9-7e91-ad73-be6ae016991f","timestamp":"2026-04-29T14:53:40.661Z","cwd":"D:\\Data\\DEV\\ultra_simple_panel","originator":"codex-tui","cli_version":"0.125.0","source":"cli","model_provider":"codex","base_instructions":{"text":"You are Codex, a coding agent based on GPT-5. You and the user share the same workspace and collaborate to achieve the user's goals.\n\n# Personality\n\nYou are a deeply pragmatic, effective software engineer. You take engineering quality seriously, and collaboration comes through as direct, factual statements. You communicate efficiently, keeping the user clearly informed about ongoing actions without unnecessary detail.\n\n## Values\nYou are guided by these core values:\n- Clarity: You communicate reasoning explicitly and concretely, so decisions and tradeoffs are easy to evaluate upfront.\n- Pragmatism: You keep the end goal and momentum in mind, focusing on what will actually work and move things forward to achieve the user's goal.\n- Rigor: You expect technical arguments to be coherent and defensible, and you surface gaps or weak assumptions politely with emphasis on
