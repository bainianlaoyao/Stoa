# Evolver 数据流转设计

本文档描述 Evolver 在项目中的完整数据管线：会话数据如何被采集、转化为内部表示、经演化后注入新会话。

## 总览

管线分三个阶段：**采集 → 演化 → 注入**。

```
Provider (Claude Code / Codex / OpenCode)
   │  HTTP hooks
   ▼
CompletionService ─── 监听 agent.turn_completed
   │
   ▼
EntireClient ─── entire-bridge CLI 导出 checkpoint
   │
   ▼
EntireStoaCheckpointExport ─── 规范中间格式
   │
   ▼
Orchestrator ─── 创建 worktree → 运行 Evolver → 发布 context
   │
   ▼
.stoa/generated/evolver-context/{target}.jsonl
   │
   ▼
SessionStart Hook ─── 读取 JSONL → 注入 agent_message
   │
   ▼
新会话上下文
```

---

## 1. 采集：会话数据 → Evolver 内部表示

### 触发机制

`DirectMemoryCompletionService`（`src/core/direct-memory/completion-service.ts`）监听规范会话事件。当收到 `intent === 'agent.turn_completed'` 的事件时，启动采集流程。

### 数据导出

`EntireClient`（`src/core/direct-memory/entire-client.ts`）调用外部 `entire-bridge` CLI 工具：

```bash
entire-bridge checkpoints --repo <repoRoot> --json           # 列出 checkpoint
entire-bridge checkpoint export <id> --repo <repoRoot> --json # 导出详情
```

产出 `EntireStoaCheckpointExport`（定义在 `src/shared/direct-memory.ts`）：

```ts
interface EntireStoaCheckpointExport {
  checkpoint_id: string
  checkpoint_format_version: 'v1'
  checkpoint_metadata_commit_sha: string
  source_worktree_commit_sha: string | null
  root_metadata_ref: string
  sessions: EntireStoaSessionExport[]
  token_usage: unknown
  combined_attribution: unknown
}

interface EntireStoaSessionExport {
  session_id: string
  agent: string
  model: string | null
  turn_id: string | null
  metadata_ref: string
  transcript_ref: string | null
  transcript_text: string | null
  prompt_ref: string | null
  prompt_text: string | null
  summary: string | null
  initial_attribution: unknown
}
```

### 去重与断点续传

`DirectMemoryBridgeStore`（`src/core/direct-memory/bridge-store.ts`）将已处理的 checkpoint 记录持久化到 `.stoa/direct-memory/bridge-refs.json`。Key 为 `{projectId}\n{stoaSessionId}\n{entireCheckpointId}`，确保同一 checkpoint 不被重复处理。

---

## 2. 演化：Checkpoint → Evolver Run → Published Context

`DirectMemoryOrchestrator.evolveAndPublish()`（`src/core/direct-memory/orchestrator.ts`）编排便携式演化流程。

### 步骤

#### 2.1 创建 Git Worktree 隔离环境

`worktree.ts` → `git worktree add --detach <path> <commitSha>`

路径：`.stoa/direct-memory/worktrees/{runId}/`

#### 2.2 运行 Evolver

`EvolverClient`（`src/core/direct-memory/evolver-client.ts`）执行：

```bash
node index.js run --json
```

通过环境变量注入桥接信息：

| 环境变量 | 来源 |
|---|---|
| `EVOLVER_REPO_ROOT` | worktree 路径 |
| `MEMORY_DIR` | `.stoa/direct-memory/{runId}/memory` |
| `EVOLUTION_DIR` | `{memoryDir}/evolution` |
| `GEP_ASSETS_DIR` | `.stoa/direct-memory/{runId}/assets/gep` |
| `EVOLVER_SESSION_SCOPE` | provider session ID |
| `STOA_PROJECT_ID` | bridge.project_id |
| `STOA_SESSION_ID` | bridge.stoa_session_id |
| `STOA_PROVIDER_SESSION_ID` | bridge.provider_session_id |
| `STOA_SOURCE_CHECKPOINT_ID` | bridge.source_checkpoint_id |
| `STOA_CHECKPOINT_METADATA_COMMIT_SHA` | bridge.checkpoint_metadata_commit_sha |
| `STOA_SOURCE_WORKTREE_COMMIT_SHA` | bridge.source_worktree_commit_sha |

Evolver 产出 `EvolverStoaRunResult`，包含 signals、selected_gene_id、artifact_refs 等。

#### 2.3 构建发布上下文

`published-context-builder.ts` 根据 target 格式构建 `EvolverPublishedContext`：

- **claude-code / codex target**：将 session 的 summary/prompt 封装为 JSONL hook 条目（含 gene_id、signals、outcome）
- **generic target**：直接读取 `memory_graph.jsonl` 原文

#### 2.4 写出发布产物

`context-delivery.ts` → 写入 `.stoa/generated/evolver-context/{target}.jsonl`

同时更新 bridge-store 中的 delivery 记录（target + SHA256 hash）。

### 备选路径：直接导入

`evolver-input-importer.ts` 提供绕过 Evolver Run 的直接转换路径，将 checkpoint 数据写成 Evolver 原生文件结构：

| 输出文件 | 内容 |
|---|---|
| `MEMORY.md` | 所有 session 的 agent/model/summary/prompt 摘要 |
| `USER.md` | 用户 prompt 和 correction 记录 |
| `{date}.md` | 按日期的记忆日志 |
| `{session_id}.jsonl` | 按 OpenClaw 格式的会话 transcript |

路径：`{memoryDir}/runtime-home/.openclaw/agents/{agentName}/sessions/`

---

## 3. 注入：新会话如何拿到演化数据

注入通过 Provider 的 Hook 机制实现。以 Claude Code 为例：

### Hook 注册

`claude-code-provider.ts` 的 `installSidecar` 方法：

1. 在 `.claude/hooks/` 生成三个 wrapper 脚本
2. 在 `.claude/settings.local.json` 注册 hook 配置

注册的 hook 事件：

| 事件 | 脚本 | 触发时机 |
|---|---|---|
| `SessionStart` | `stoa-evolver-session-start.cjs` | 新会话启动 |
| `PostToolUse` (matcher: `Write`) | `stoa-evolver-signal-detect.cjs` | 文件写入后 |
| `Stop` | `stoa-evolver-session-end.cjs` | 会话结束时 |

### Wrapper 脚本

每个 wrapper 由 `buildEvolverWrapperSource()` 动态生成，作用是：

```js
// 1. 环境准备：将已发布的上下文路径设为 MEMORY_GRAPH_PATH
const publishedContextPath = join(process.cwd(), '.stoa', 'generated', 'evolver-context', 'claude-code.jsonl');
if (!process.env.MEMORY_GRAPH_PATH && existsSync(publishedContextPath)) {
  process.env.MEMORY_GRAPH_PATH = publishedContextPath;
}

// 2. 设置 EVOLVER_ROOT
process.env.EVOLVER_ROOT = '<evolver repo root>';

// 3. 加载上游脚本
require('<evolver>/src/adapters/scripts/evolver-session-start.js');
```

### SessionStart — 注入演化记忆

`evolver-session-start.js`：

1. 查找 `MEMORY_GRAPH_PATH` 环境变量指向的 JSONL（回退到 `{evolverRoot}/memory/evolution/memory_graph.jsonl`）
2. 读取最后 5 条记录
3. 格式化为人类可读摘要：

```
[Evolution Memory] Recent 5 outcomes (4 success, 1 failed):
[+] 2026-04-27 score=0.8 signals=[log_error, perf_bottleneck] Fixed timeout in API handler
[-] 2026-04-27 score=0.3 signals=[test_failure] Attempted refactor broke auth tests
...

Use successful approaches. Avoid repeating failed patterns.
```

4. 输出 `{ agent_message: summary, additionalContext: summary }` → Claude Code 将其注入会话上下文

**去重机制**：当 `EVOLVER_SESSION_START_DEDUP=1` 时，基于 cwd 做 TTL 内去重（默认 30 分钟），防止同一 workspace 在短时间内重复注入。

### PostToolUse (Write) — 实时信号检测

`evolver-signal-detect.js`：

1. 读取 stdin 中的编辑事件 JSON
2. 检测信号关键词（perf_bottleneck, capability_gap, log_error, test_failure 等）
3. 输出 `additional_context` 提示

### Stop — 记录会话产出

`evolver-session-end.js`：

1. `git diff --stat HEAD~1` 收集变更统计
2. `detectSignals()` 从 diff 中提取信号
3. 构建 outcome：`{ status: 'success'|'failed', score, signals, summary }`
4. `recordToLocal()` → 追加到 `memory_graph.jsonl`
5. 或 `recordToHub()` → POST 到 EvoMap Hub（如已配置）

---

## 数据闭环

```
┌─────────────────────────────────────────────────┐
│                    新会话                         │
│                                                   │
│  SessionStart hook                                │
│    ↓ 读取 memory_graph.jsonl 最后 N 条            │
│    ↓ 注入 agent_message 到上下文                   │
│                                                   │
│  会话进行中                                        │
│    ↓ PostToolUse hook 实时信号检测                  │
│                                                   │
│  会话结束                                          │
│    ↓ Stop hook → git diff → 信号提取               │
│    ↓ outcome 追加到 memory_graph.jsonl             │
│                                                   │
│  CompletionService                                │
│    ↓ entire-bridge 导出 checkpoint                 │
│    ↓ Orchestrator 运行 Evolver 演化                │
│    ↓ 发布到 .stoa/generated/evolver-context/       │
│                                                   │
│  → 下一个 SessionStart hook 读取更新后的 context    │
└─────────────────────────────────────────────────┘
```

## 关键文件索引

| 文件 | 职责 |
|---|---|
| `src/shared/direct-memory.ts` | 所有共享类型定义 |
| `src/core/direct-memory/completion-service.ts` | 会话事件监听与采集调度 |
| `src/core/direct-memory/entire-client.ts` | Entire Bridge CLI 封装 |
| `src/core/direct-memory/evolver-client.ts` | Evolver CLI 封装 |
| `src/core/direct-memory/orchestrator.ts` | 演化与发布编排器 |
| `src/core/direct-memory/published-context-builder.ts` | 发布上下文构建 |
| `src/core/direct-memory/context-delivery.ts` | 发布产物写出 |
| `src/core/direct-memory/bridge-store.ts` | 桥接记录持久化与去重 |
| `src/core/direct-memory/evolver-input-importer.ts` | Checkpoint 直接转换为 Evolver 原生格式 |
| `src/core/direct-memory/worktree.ts` | Git worktree 管理 |
| `src/extensions/providers/claude-code-provider.ts` | Hook 注册与 wrapper 生成 |
| `research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js` | 会话启动注入脚本 |
| `research/upstreams/evolver/src/adapters/scripts/evolver-signal-detect.js` | 信号检测脚本 |
| `research/upstreams/evolver/src/adapters/scripts/evolver-session-end.js` | 会话结束记录脚本 |
