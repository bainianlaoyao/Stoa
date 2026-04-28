---
date: 2026-04-27
topic: stoa-folder-consolidation-complexity
status: completed
mode: context-gathering
sources: 18
---

## Context Report: 记忆系统 Entire/Evolver 产物迁移到 .stoa 的复杂度评估

### Why This Was Gathered
评估将 Entire 和 Evolver 的所有磁盘产物统一收拢到 `.stoa` 文件夹下、避免污染工作区根目录的改造复杂度。

### Summary
**当前状态：大部分产物已在 `.stoa` 下，但存在 3 个污染点。** Evolver 的 memory/worktree/assets 产物已经写入 `.stoa/direct-memory/`，Published context 已经写入 `.stoa/generated/`。但有三类产物仍在工作区根目录造成污染：(1) Entire 的 `.entire/checkpoints/` 目录、(2) `CLAUDE.md` 文件被注入 managed block、(3) `.claude/hooks/` 下的 Evolver wrapper 脚本。整体改造复杂度 **中低**，涉及约 4-6 个文件改动，但 CLAUDE.md 的变更需要谨慎处理。

### Key Findings

#### 1. 已经在 `.stoa` 下的产物（无需改动）

| 产物 | 路径 | 来源文件 |
|------|------|----------|
| Bridge refs store | `.stoa/direct-memory/bridge-refs.json` | `completion-service.ts:308` |
| Evolver memory dir | `.stoa/direct-memory/{runId}/memory/` | `orchestrator.ts:76` |
| Evolver evolution dir | `.stoa/direct-memory/{runId}/memory/evolution/` | `orchestrator.ts:77` |
| GEP assets dir | `.stoa/direct-memory/{runId}/assets/gep/` | `orchestrator.ts:78` |
| Git worktrees | `.stoa/direct-memory/worktrees/{runId}/` | `worktree.ts:63` |
| Published context JSONL | `.stoa/generated/evolver-context/{target}.jsonl` | `context-delivery.ts:24` |
| Published context MD | `.stoa/generated/evolver-context/claude-code.md` | `context-delivery.ts:41` |
| Project sessions | `.stoa/sessions.json` | `state-store.ts:51` |
| Global state | `~/.stoa/global.json` | `state-store.ts:47` |

这些产物已经集中在 `.stoa`，且 `.gitignore` 已包含 `.stoa/`（第 17 行）。

#### 2. 污染点 A：Entire checkpoint 目录 `.entire/`

**现状**：Entire（外部 CLI 工具）将 checkpoints 写入工作区根目录的 `.entire/checkpoints/`。Stoa 的代码不直接控制这个路径——它是 Entire CLI 自身的行为。Stoa 只消费 `.entire/` 下的 ref 路径（如 `root_metadata_ref: '.entire/checkpoints/chk_1/metadata.json'`）。

**复杂度**：🔴 **高/不可控** — Stoa 无法直接控制 Entire CLI 的输出目录。需要：
- Entire CLI 提供配置项（如 `--checkpoint-dir` 或环境变量）
- 或者 Stoa 在 Entire 运行后移动文件到 `.stoa/entire/checkpoints/`
- 或者接受 `.entire/` 作为外部工具的副作用（仅加 `.gitignore`）

**涉及文件**：
- `src/core/direct-memory/entire-client.ts` — 调用 entire CLI
- `src/shared/direct-memory.ts` — 类型定义中 `root_metadata_ref` 等路径 ref
- `src/core/direct-memory/published-context-builder.ts` — 读取 checkpoint ref

#### 3. 污染点 B：`CLAUDE.md` 被 Stoa 注入 managed block

**现状**：`context-delivery.ts:88-111` 直接写入工作区根目录的 `CLAUDE.md`，注入 `<!-- STOA DIRECT MEMORY:BEGIN -->...<!-- STOA DIRECT MEMORY:END -->` 管理块。

**复杂度**：🟡 **中** — Claude Code 原生只读工作区根的 `CLAUDE.md`，如果移动到 `.stoa/` 下，Claude Code 不会自动加载它。可能的方案：
- (a) 继续在根目录维护 `CLAUDE.md` 但将其视为"Stoa 管理的符号链接"——本质不解决污染
- (b) 改用 `CLAUDE.md` 的 `@import` 或 include 机制（如果 Claude Code 支持）
- (c) 改为仅写入 `.stoa/generated/evolver-context/claude-code.md`，在 Claude hook 脚本中读取并注入到 prompt
- (d) 在 Claude Code 的 `--append-system-prompt` 或类似参数中传入

**涉及文件**：
- `src/core/direct-memory/context-delivery.ts` — `writeClaudeInstructionFile()` 函数
- `src/core/direct-memory/context-delivery.test.ts` — 3 个测试用例验证 CLAUDE.md 交互

#### 4. 污染点 C：`.claude/hooks/` 下的 Evolver wrapper 脚本

**现状**：`claude-code-provider.ts:188-211` 在 `.claude/hooks/` 目录下写入 3 个 Evolver wrapper CJS 脚本。这是 Claude Code 的 hooks 机制要求——hooks 必须在 `.claude/` 下声明。

**复杂度**：🟡 **中** — `.claude/hooks/` 是 Claude Code provider 机制的一部分，不能随意移动。但可以：
- (a) 在 `.stoa/hooks/` 存放实际脚本，`.claude/hooks/` 只放薄 shim 脚本
- (b) 接受 `.claude/` 为 provider 必要副作用（同样加 `.gitignore`，事实上 `.gitignore` 已有 `.claude` 第 10 行）

**涉及文件**：
- `src/extensions/providers/claude-code-provider.ts` — `writeEvolverHookWrappers()`
- `src/extensions/providers/claude-code-provider.test.ts` — 3 个测试用例

#### 5. 类似污染：`.codex/` 和 `.opencode/`

**现状**：Codex provider 在 `.codex/` 写入 sidecar 文件，OpenCode provider 在 `.opencode/plugins/` 写入插件。同样已在 `.gitignore` 中。

**复杂度**：🟢 **低** — 这些是各 provider 的标准 sidecar 安装路径，与记忆系统无关。

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Evolver 产物已在 `.stoa/direct-memory/` | `orchestrator.ts` | `:76-78` |
| Published context 写入 `.stoa/generated/` | `context-delivery.ts` | `:24, :41` |
| Bridge store 路径 | `completion-service.ts` | `:308` |
| Git worktree 路径 | `worktree.ts` | `:63` |
| CLAUDE.md 被注入 managed block | `context-delivery.ts` | `:88-111` |
| Evolver hooks 写入 `.claude/hooks/` | `claude-code-provider.ts` | `:188-211` |
| `.entire/` 路径 ref 来自 Entire CLI 外部工具 | `direct-memory.ts` (shared types) | `:7-13` |
| `.gitignore` 已包含 `.stoa/`, `.claude`, `.codex/` | `.gitignore` | `:10, :16-17` |
| Project sessions 在 `.stoa/sessions.json` | `state-store.ts` | `:51` |
| Global state 在 `~/.stoa/global.json` | `state-store.ts` | `:47` |
| Claude hook 加载 `.stoa/generated/evolver-context/` | `claude-code-provider.ts` | `:173-175` |

### Risks / Unknowns

- [!] **CLAUDE.md 是 Claude Code 的 contract 入口** — Claude Code 只读工作区根的 `CLAUDE.md`，移动它会打破 provider 的上下文注入机制。需要调研 Claude Code 是否支持自定义 instruction file 路径。
- [!] **`.entire/` 由外部 Entire CLI 控制** — Stoa 无法直接改变其输出路径，除非 Entire CLI 提供配置能力或 Stoa 做 post-hoc 搬运。
- [?] Claude Code hooks 的 `command` 路径是否可以是绝对路径（若可以，可指向 `.stoa/hooks/`）。
- [?] Codex/OpenCode provider 的 sidecar 安装路径是否也需要统一迁移（不在本次 scope 内但值得记录）。

### 复杂度评估总结

| 污染点 | 复杂度 | 涉及文件数 | 涉及测试数 | 风险 |
|--------|--------|-----------|-----------|------|
| Entire `.entire/` | 高（外部工具） | 3-4 | 3-4 | 高 |
| `CLAUDE.md` 注入 | 中 | 2 | 3 | 中 |
| `.claude/hooks/` | 中 | 2 | 3 | 低 |
| **总计** | **中低（可控部分）** | **~6** | **~8** | — |

**结论**：如果你说的"污染"主要指 Evolver 的 memory/worktree/assets 产物，**这些已经在 `.stoa` 下**，无需改动。真正的污染点是 `CLAUDE.md` 注入和 `.claude/hooks/` 脚本——但两者各有外部约束（Claude Code 的 contract 要求），改动需配合 provider adapter 层重设计。`.entire/` 则完全受控于外部 CLI。

**实际可改范围预估**：如果目标是将 Stoa 自身可控的产物全部收进 `.stoa`，改动量约 **1-2 天**（CLAUDE.md 交付机制改造 + 测试更新）。如果还包括 `.entire/` 迁移，需要先确认 Entire CLI 的可配置性。
