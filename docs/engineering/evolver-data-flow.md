# Evolver 数据流转设计

本文档描述当前仓库里已经落地的 Evolver 记忆链路。正常运行路径不再依赖 Entire；Stoa 直接持有证据、运行 Evolver、并在 Claude Code 启动前发布可消费上下文。

## 总览

```
Provider hook / notify evidence
  -> SessionEventBridge
  -> .stoa/memory/evidence/
  -> MemoryRuntime
  -> EvolverMaintainer
  -> .stoa/memory/runtime-state.json
  -> ClaudeCodeInjector
  -> .stoa/generated/evolver-context/claude-code.jsonl
  -> Claude SessionStart wrapper
  -> Evolver upstream session-start hook
```

关键实现文件：

- `src/main/session-event-bridge.ts`
- `src/core/memory/session-evidence-store.ts`
- `src/core/memory/runtime.ts`
- `src/core/memory/evolver-maintainer.ts`
- `src/core/memory/runtime-state-store.ts`
- `src/core/memory/claude-code-injector.ts`
- `src/extensions/providers/claude-code-provider.ts`

## 1. 证据采集

`SessionEventBridge` 负责接收规范化后的 provider 事件，并在事件带有 `event.evidence` 时持久化证据。

- 入口：`src/main/session-event-bridge.ts`
- 快照生成：`src/core/memory/transcript-snapshot.ts`
- 落盘：`src/core/memory/session-evidence-store.ts`

落盘目录：

```
.stoa/memory/evidence/{stoaSessionId}/{eventId}/
  metadata.json
  transcript.jsonl | turn-slice.json
```

`metadata.json` 保存这些信息：

- Stoa `projectId` / `sessionId`
- provider 类型
- provider session id
- turn id
- 原始 `payload`
- 规范化 `evidence`
- 快照文件类型和源 transcript 指针

这一层的目标是让后续记忆处理不依赖 provider 自己的 transcript 文件还能一直存在。

## 2. 运行时触发

`SessionEventBridge` 在处理每个展开后的 provider 事件时按这个顺序执行：

1. 持久化证据
2. 写 observability
3. 应用 session state patch
4. 解析项目路径并调用 `memoryRuntime.notifyTurnCompleted(...)`

`MemoryRuntime` 只处理 `agent.turn_completed`，并按 `session_id` 串行排队，避免同一会话的记忆维护并发踩踏。

实现文件：

- `src/main/session-event-bridge.ts`
- `src/core/memory/runtime.ts`

## 3. Maintainer 阶段

`EvolverMaintainer.processTurnCompletion()` 是固定内置 maintainer。

### 3.1 取未处理证据

`RuntimeStateStore` 在 `.stoa/memory/runtime-state.json` 中记录：

- `sessionProgress`
- `runRecords`
- `publishedRecords`

其中 `sessionProgress.lastProcessedEvidenceKey` 用来裁掉已经处理过的 evidence snapshot。

### 3.2 生成语义摘要

Maintainer 会把未处理证据拼成 prompt，交给 `CliAiProvider`。这个 provider 使用设置里的 `memoryAiProvider` 选择 `claude-code` 或 `codex` 可执行文件，负责三类非交互任务：

- 会话摘要
- review 决策
- distillation 响应

实现文件：

- `src/core/memory/evolver-maintainer.ts`
- `src/core/memory/cli-ai-provider.ts`
- `src/core/provider-path-resolver.ts`

### 3.3 物化 Evolver 输入

`materializeEvidenceSnapshotsIntoEvolverInputs()` 会把证据写成 Evolver 当前可消费的文件集：

- `{worktreeRepoRoot}/MEMORY.md`
- `{worktreeRepoRoot}/USER.md`
- `{memoryDir}/{yyyy-mm-dd}.md`
- `{memoryDir}/runtime-home/.openclaw/agents/{agent}/sessions/*.jsonl`

实现文件：

- `src/core/memory/evolver-input-materializer.ts`

### 3.4 创建隔离 worktree

Maintainer 先解析 git repo root 和 `HEAD`，然后在下面创建 detached worktree：

```
.stoa/memory/worktrees/{runId}/
```

实现文件：

- `src/core/memory/worktree.ts`

### 3.5 运行 Evolver

Maintainer 通过 `EvolverClient.run()` 调用内置的 Evolver 仓库：

- CLI 解析：`src/core/memory/bundled-evolver.ts`
- JSON 命令执行：`src/core/memory/command-runner.ts`
- Evolver 客户端：`src/core/memory/evolver-client.ts`

Stoa 为每次运行分配：

```
.stoa/memory/runs/{runId}/memory
.stoa/memory/runs/{runId}/evolution
.stoa/memory/runs/{runId}/gep-assets
```

并通过环境变量传给 Evolver：

- `EVOLVER_REPO_ROOT`
- `MEMORY_DIR`
- `EVOLUTION_DIR`
- `GEP_ASSETS_DIR`
- `EVOLVER_SESSION_SCOPE`
- `STOA_PROJECT_ID`
- `STOA_SESSION_ID`
- `STOA_PROVIDER_SESSION_ID`

### 3.6 Review 与 Distill

如果 Evolver run 返回 `review_status === 'pending'`，Maintainer 会：

1. `exportReview()`
2. 交给 `CliAiProvider.review(...)`
3. 根据结果调用 `approveReview()` 或 `rejectReview()`

当 review 最终为 `approved` 时，Maintainer 继续：

1. `prepareDistillation()`
2. 交给 `CliAiProvider.distill(...)`
3. 将纯文本响应写入响应文件
4. `completeDistillation(responseFilePath)`

这里不依赖 Evolver 默认的 `llmReview.js` stub。

## 4. 运行时状态

`RuntimeStateStore` 当前保存三类状态：

### `sessionProgress`

按 `{projectId, stoaSessionId}` 记录上次处理到的 evidence key。

### `runRecords`

按 `{projectId, stoaSessionId}` 记录一次会话最近一次 Evolver run：

- `runId`
- `providerSessionId`
- `worktreePath`
- `memoryDir`
- `evolutionDir`
- `gepAssetsDir`
- `reviewStateRef`
- `reviewStatus`
- `lastError`

### `publishedRecords`

按 `{projectId, stoaSessionId, consumer}` 记录某次注入动作的发布状态和 hash。

实现文件：

- `src/core/memory/runtime-state-store.ts`

## 5. Claude 注入阶段

`launchTrackedSessionRuntime()` 在启动 `claude-code` session 之前调用 `ClaudeCodeInjector.injectLatestContext(...)`。

当前选择逻辑：

1. 优先使用当前 `stoaSessionId` 对应的 approved run
2. 如果当前 session 还没有 approved run，则回退到同一项目里最新的 approved run

第二步就是“上一个会话学到的记忆，在下一个会话启动时可被消费”的桥接点。

注入器做的事情：

1. 选择 run
2. 调用 `publish-context --target=claude-code`
3. 写出 `.stoa/generated/evolver-context/claude-code.jsonl`
4. 计算 sha256 hash
5. 更新当前 session 的 published record

实现文件：

- `src/main/launch-tracked-session-runtime.ts`
- `src/core/memory/claude-code-injector.ts`

## 6. Claude Code 消费路径

`claude-code-provider.ts` 现在只负责两类 hook：

1. Stoa HTTP hooks
   - `UserPromptSubmit`
   - `PreToolUse`
   - `Stop`
   - `StopFailure`
   - `PermissionRequest`
2. 一个 Evolver `SessionStart` command wrapper

不会再自动安装：

- `stoa-evolver-signal-detect.cjs`
- `stoa-evolver-session-end.cjs`

`SessionStart` wrapper 的职责只有两件事：

1. 如果 `.stoa/generated/evolver-context/claude-code.jsonl` 存在，并且当前进程还没设置 `MEMORY_GRAPH_PATH`，就把它指过去
2. `require()` 上游 `evolver-session-start.js`

因此 Claude Code 真正消费的是 Evolver 原生 `publish-context` 产出的 JSONL。

实现文件：

- `src/extensions/providers/claude-code-provider.ts`
- `research/upstreams/evolver/src/stoa/publishContext.js`

## 7. Entire 的位置

Entire 仍然可以保留为显式离线工具，但它已经不在正常 build / runtime 链路里：

- `package.json` 的 `build` 不再调用 `build:entire-bridge`
- 正常记忆环路不再读取 `src/core/direct-memory/`
- 正常记忆环路的输入来自 `.stoa/memory/evidence/`

这意味着当前主路径是：

**provider-native evidence -> Stoa-owned runtime -> Evolver native publish format -> Claude SessionStart consumption**
