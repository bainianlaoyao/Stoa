---
date: 2026-05-29
topic: orca-file-map-subagent
status: completed
mode: context-gathering
sources: 45
---

## Context Report: Orca Upstream File Map — CLI/Session/Orchestration/Frontend Sync

### Why This Was Gathered
Bounded context research to map Orca upstream files relevant to: CLI command dispatch, session/terminal lifecycle, subagent control (orchestration), and frontend/runtime synchronization patterns. No implementation work — extract reusable patterns only.

### Summary
Orca's architecture splits cleanly into CLI layer (TypeScript CLI that communicates via `RuntimeClient`), main process layer (Electron main + `OrcaRuntimeService`), and RPC dispatch (Zod-validated method registry). Orchestration (inter-agent messaging, task DAG, dispatch) lives in a SQLite-backed `OrchestrationDb` at `src/main/runtime/orchestration/db.ts`. Terminal/PTY management is full-featured with binary stream framing (`TerminalStreamOpcode`). Frontend sync uses `RuntimeSyncWindowGraph` with `tabId`, `leafId`, `worktreeId` tracking.

### Key Files

#### CLI Dispatch Layer
| File | Purpose |
|------|---------|
| `src/cli/index.ts:23-75` | Entry point: parses args → creates `RuntimeClient` → calls `dispatch()` |
| `src/cli/dispatch.ts:29-58` | Builds handler map from named handler groups; `dispatch()` does `HANDLERS.get(commandPath.join(' '))` lookup at line 63 |
| `src/cli/handlers/worktree.ts` | Worktree CRUD: `worktree create/list/show/ps/set/rm`. Parent lineage auto-inferred from cwd. |
| `src/cli/handlers/terminal.ts` | Terminal lifecycle: `terminal create/list/show/read/send/wait/stop/rename/split/focus/close`. Line 44: `DEFAULT_TERMINAL_WAIT_RPC_TIMEOUT_MS = 5 * 60 * 1000` (5 min for long waits). |
| `src/cli/handlers/orchestration.ts` | Orchestration CLI: `send/check/reply/inbox/task-create/task-list/task-update/dispatch/dispatch-show/ask/run/gate-*`. Line 12: `DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000` (15s). |
| `src/cli/selectors.ts:19-76` | Worktree selector resolution: `buildCurrentWorktreeSelector()` → `path:<cwd>`; `resolveCurrentWorktreeSelector()` filters by `isWithinPath`. |

#### Runtime Client & Transport
| File | Purpose |
|------|---------|
| `src/cli/runtime-client.ts` | Barrel re-export; actual impl in `src/cli/runtime/client.ts` |
| `src/cli/runtime/client.ts:24-84` | `RuntimeClient.call<TResult>()` — local: reads metadata → `sendRequest()`; remote: `sendWebSocketRequest()`. `resolveMethodTimeoutMs()` at line 91 extends timeout for `orchestration.check` + `terminal.wait` long-polls. |
| `src/cli/runtime/launch.ts:5-55` | `launchOrcaApp()` — tries `ORCA_OPEN_COMMAND` env → `ORCA_APP_EXECUTABLE` → Mac `open` → `process.execPath`. `serveOrcaApp()` for background server mode. |
| `src/cli/runtime/transport.ts` | Local transport: Unix socket or named pipe. |
| `src/cli/runtime/websocket-transport.ts` | Remote transport for paired runtimes. |
| `src/shared/runtime-rpc-envelope.ts:38-62` | Envelope schema: `RuntimeRpcSuccess<TResult>`, `RuntimeRpcFailure`, `RuntimeRpcKeepaliveFrame`. `_keepalive: true` frames keep long-polls alive. |

#### Main Process RPC Layer
| File | Purpose |
|------|---------|
| `src/main/ipc/register-core-handlers.ts:70-165` | Central registration of all IPC handlers. `registerRuntimeHandlers(runtime)` at line 159 wires the runtime RPC server. |
| `src/main/runtime/rpc/dispatcher.ts:26-185` | `RpcDispatcher` — parses request, validates via Zod schema from `registry`, calls `method.handler()`, maps errors by `browser.` prefix or Zod error. |
| `src/main/runtime/rpc/methods/terminal.ts:459-1333` | All terminal RPC methods. Key patterns: `defineMethod()` + `defineStreamingMethod()` at line 3. `terminal.subscribe` streams output; `terminal.multiplex` owns binary socket. Mobile-fit via `runtime.handleMobileSubscribe()`. |
| `src/main/runtime/rpc/methods/orchestration.ts:145-589` | All orchestration RPC methods. `OrchestrationDb` used at line 150 for message/task CRUD. Dispatch inject check at line 417-425: `runtime.isTerminalRunningAgent(to)` validates agent CLI presence before `--inject`. |
| `src/main/runtime/rpc/methods/worktree.ts` | Worktree CRUD on the server side. |

#### Orchestration (Inter-Agent Messaging + Task DAG)
| File | Purpose |
|------|---------|
| `src/main/runtime/orchestration/db.ts:44-200+` | `OrchestrationDb` — SQLite-backed. Schema v4. Tables: `messages` (with `delivered_at`), `tasks` (DAG with `deps` JSON array), `dispatch_contexts`, `decision_gates`, `coordinator_runs`. Auto-promotes ready tasks after `updateTaskStatus`. |
| `src/main/runtime/orchestration/preamble.ts` | `buildDispatchPreamble()` — generates injection text teaching workers `orca orchestration send --type worker_done`. |
| `src/main/runtime/orchestration/formatter.ts` | `formatMessageBanner()` — human-readable message formatting. |
| `src/main/runtime/rpc/methods/orchestration-gates.ts` | Gate methods: `gate-create/resolve/list`. Gates block tasks and complete active dispatch. |

#### Session & Terminal State
| File | Purpose |
|------|---------|
| `src/shared/runtime-types.ts:76-98` | `RuntimeSyncWindowGraph` — `tabs: RuntimeSyncedTab[]`, `leaves: RuntimeSyncedLeaf[]`. Each entry has `tabId`, `leafId`, `worktreeId`, `paneRuntimeId`, `ptyId`. |
| `src/shared/runtime-types.ts:280-356` | `RuntimeTerminalSummary` / `RuntimeTerminalRead` / `RuntimeTerminalSend` — handle-based terminal state. `handle` is the runtime-scoped identifier. |
| `src/shared/terminal-stream-protocol.ts` | Binary terminal stream framing: `TerminalStreamOpcode` enum (Output, Input, Resize, SnapshotStart/Chunk/End, Subscribe, Unsubscribe, Error). `encodeTerminalStreamFrame()` / `decodeTerminalStreamFrame()`. |

#### Skills (Agent Guidance)
| File | Purpose |
|------|---------|
| `skills/orca-cli/SKILL.md` | Public CLI surface: worktree/terminal/browser commands. `terminal wait --for tui-idle` detects agent CLI idle via OSC title transition. |
| `skills/orchestration/SKILL.md` | Inter-agent coordination: messaging, task DAG, dispatch, decision gates, coordinator loop. |
| `skills/computer-use/SKILL.md` | Desktop app automation via accessibility tree. |

### Reusable Patterns

1. **Handler registry pattern** (`dispatch.ts:29-58`): Group handlers in named objects (`CORE_HANDLERS`, `ORCHESTRATION_HANDLERS`), build a flat `Map<string, CommandHandler>`, dispatch via `HANDLERS.get(commandPath.join(' '))`. Duplicates throw at registration time.

2. **RuntimeClient with dual transport** (`runtime/client.ts:50-84`): Local path reads metadata file → Unix socket; remote path uses WebSocket with pairing code. `call()` method resolves transport at call time.

3. **Long-poll timeout extension** (`runtime/client.ts:91-102`): `orchestration.check --wait` and `terminal.wait` extend client timeout beyond 60s default. `LONG_POLL_CLIENT_GRACE_MS = 10_000`.

4. **Zod-validated RPC methods** (`rpc/dispatcher.ts:35-73`): `defineMethod({ name, params, handler })` registers methods with Zod param schemas. Error mapping by `method.startsWith('browser.')` prefix.

5. **Streaming RPC** (`rpc/dispatcher.ts:78-148`): `dispatchStreaming()` takes `reply` callback for multi-response streaming. `emit({ streaming: true })` flag marks streams.

6. **OrchestrationDb transaction locality** (`orchestration/db.ts:44`): Schema creation, migration, and CRUD in one class. `updateTaskStatus()` auto-calls `promoteReadyTasks()` in the same writer transaction.

7. **Binary terminal stream multiplexing** (`methods/terminal.ts:687-990`): `terminal.multiplex` owns binary socket, routes by `streamId`. `TerminalStreamOpcode` framing for output/input/resize/subscribe/unsubscribe.

8. **Worktree selector resolution** (`selectors.ts:50-76`): `current` → `path:<cwd>`, then `resolveCurrentWorktreeSelector()` uses `isWithinPath()` to find enclosing worktree. Handles `active`/`current` aliases.

9. **Heartbeat during long waits** (`handlers/orchestration.ts:34-52`): `startCheckHeartbeat()` emits `{ _heartbeat: true, elapsedMs, deadlineMs }` to stderr every 15s so parent process sees liveness. Timer is `unref()`'d.

10. **Agent detection before dispatch inject** (`methods/orchestration.ts:417-425`): `runtime.isTerminalRunningAgent(to)` checks for recognized agent CLI (Claude Code, Codex, etc.) before injecting preamble.

### Open Questions

- **?**: How does `OrcaRuntimeService` (the main runtime interface) expose `getOrchestrationDb()`, `isTerminalRunningAgent()`, `waitForMessage()`? Full interface not read — check `src/main/runtime/orca-runtime.ts`.
- **?**: Frontend sync: how does the renderer receive `RuntimeSyncWindowGraph` updates? Does it come via IPC (`src/main/ipc/session.ts`) or via shared state? Not traced.
- **?**: `src/main/ipc/pty.ts` — what PTY lifecycle management exists beyond `terminal.create`? Not read.
- **?**: Session persistence: `src/main/ipc/session.ts` — how are sessions persisted across app restarts? Not read.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| CLI dispatches via flat handler map | `dispatch.ts:63` | `HANDLERS.get(commandPath.join(' '))` |
| RuntimeClient dual transport | `runtime/client.ts:50-84` | Local vs WebSocket branch |
| Long-poll timeout extension | `runtime/client.ts:91-102` | `resolveMethodTimeoutMs()` |
| OrchestrationDb schema v4 | `orchestration/db.ts:42` | `SCHEMA_VERSION = 4` |
| Terminal handle-based API | `runtime-types.ts:280` | `RuntimeTerminalSummary.handle` |
| Binary stream framing | `terminal-stream-protocol.ts` | `TerminalStreamOpcode` enum |
| Agent detection before inject | `methods/orchestration.ts:417` | `runtime.isTerminalRunningAgent(to)` |
| Heartbeat during waits | `handlers/orchestration.ts:34` | `startCheckHeartbeat()` |
| Worktree selector resolution | `selectors.ts:50-76` | `resolveCurrentWorktreeSelector()` |

### Report Path

```
D:/Data/DEV/ultra_simple_panel/research/2026-05-29-orca-file-map-subagent.md
```