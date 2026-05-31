---
date: 2026-05-29
topic: Orca Upstream Subagent/Orchestration Control Patterns
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Orca Upstream Subagent/Orchestration Control Patterns

### Why This Was Gathered
Inform design of Stoa's own agent coordination layer by studying Orca's production-grade patterns for task dispatch, inter-agent messaging, worker completion signals, and terminal interaction.

### Summary
Orca's orchestration layer is a CLI-first RPC system layered over a running Orca runtime, using a SQLite-backed inter-agent mail store for messaging, a DAG-based task tracker for work decomposition, and runtime-scoped terminal handles for agent coordination. Agents communicate completion via typed messages (`worker_done`, `escalation`) delivered push-on-idle, and the CLI surfaces all of this through the `orca orchestration` and `orca terminal` command groups. Terminal identity is provided via injected `ORCA_TERMINAL_HANDLE` env var, not static handles.

### Key Findings

**1. Inter-Agent Messaging (Push-on-Idle)**

Messages are persisted to a SQLite-backed mail store and delivered automatically when the recipient agent goes idle. The message bus is typed, priority-aware, and supports fan-out to groups (`@all`, `@idle`, `@claude`, `@codex`, `@worktree:<id>`).

| Claim | Source | Location |
|-------|--------|----------|
| Message bus is SQLite-backed, delivery is push-on-idle | `skills/orchestration/SKILL.md` | lines 39-40 |
| `--inject` formats messages as readable banners | `skills/orchestration/SKILL.md` | line 51 |
| Message types: `status`, `dispatch`, `worker_done`, `merge_ready`, `escalation`, `handoff`, `decision_gate` | `skills/orchestration/SKILL.md` | line 55 |
| `--wait` blocks until a matching message arrives; returns immediately if unread messages already exist | `skills/orchestration/SKILL.md` | line 52 |
| Group addresses fan out: one message per recipient, shared `thread_id` | `skills/orchestration/SKILL.md` | lines 70-71 |

**2. Task DAG with Auto-Promotion**

Task tracking with DAG dependencies. A task becomes `ready` only when all tasks in its `deps` array are `completed`. The runtime automatically promotes dependent tasks — this is the DAG resolution step.

| Claim | Source | Location |
|-------|--------|----------|
| Task becomes `ready` when all `deps` are `completed` | `skills/orchestration/SKILL.md` | line 74 |
| Marking a task `completed` auto-promotes pending dependents to `ready` | `skills/orchestration/SKILL.md` | line 85 |
| Task statuses: `pending`, `ready`, `dispatched`, `completed`, `failed`, `blocked` | `skills/orchestration/SKILL.md` | line 83 |
| Circuit breaker: after 3 consecutive failures, dispatch is marked `circuit_broken`, task is `failed` | `skills/orchestration/SKILL.md` | lines 101-102 |

**3. Task Dispatch with Preamble Injection**

Dispatch assigns a ready task to a terminal. The `--inject` flag sends a preamble that teaches the agent how to use `orca orchestration send --type worker_done` to report completion. Dispatch contexts are separate from tasks (sling pattern).

| Claim | Source | Location |
|-------|--------|----------|
| `--inject` sends a preamble teaching the agent to report `worker_done` | `skills/orchestration/SKILL.md` | lines 88-96 |
| Dispatch contexts are separate from tasks; a task can be re-dispatched after failure | `skills/orchestration/SKILL.md` | line 99 |
| `--inject` requires a recognized agent CLI (Claude Code, etc.) in the target terminal | `skills/orchestration/SKILL.md` | line 97 |
| Only recognized agent CLIs support `tui-idle` detection; bare shells hang until timeout | `skills/orchestration/SKILL.md` | line 158 |

**4. Terminal Handle Identity via Env Injection**

Every Orca-managed terminal has a runtime-scoped handle. The identity is provided via the `ORCA_TERMINAL_HANDLE` environment variable injected into the terminal at spawn time. Handles are ephemeral and become stale after Orca restarts.

| Claim | Source | Location |
|-------|--------|----------|
| `--from` auto-resolves via `ORCA_TERMINAL_HANDLE` env var | `skills/orchestration/SKILL.md` | line 49 |
| Terminal handles are runtime-scoped and may go stale after reloads | `skills/orchestration/SKILL.md` | line 223 |
| Terminal handles go stale if Orca restarts mid-workflow; re-acquire with `terminal list` | `skills/orchestration/SKILL.md` | line 178 |
| `terminal wait --for tui-idle` detects the working→idle OSC title transition | `skills/orchestration/SKILL.md` | line 158 |

**5. Worker Completion Signal: tui-idle Detection**

Orca detects agent completion via OSC title transitions (working→idle). This works for recognized agent CLIs (Claude Code, Codex, Gemini, etc.). The pattern `check --wait --types worker_done,escalation` is the primary feedback loop; `terminal wait --for tui-idle` is the fallback.

| Claim | Source | Location |
|-------|--------|----------|
| `--wait --types worker_done,escalation` blocks until worker signals back | `skills/orchestration/SKILL.md` | line 175 |
| After receiving `worker_done`, that terminal is guaranteed idle — skip `tui-idle` check and dispatch next task immediately | `skills/orchestration/SKILL.md` | line 177 |
| Fallback: `terminal wait --for tui-idle` then `terminal read` if `--wait` times out | `skills/orchestration/SKILL.md` | lines 203-206 |

**6. Heartbeat Pattern for Long Waits**

During `--wait`, the CLI emits JSON heartbeat lines to stderr every 15 seconds (configurable via `ORCA_HEARTBEAT_INTERVAL_MS`). This prevents the parent process's Bash tool from auto-backgrounding the subprocess due to ~2 minutes of silence.

| Claim | Source | Location |
|-------|--------|----------|
| Heartbeat interval is 15 s, chosen to stay under Claude Code's Bash silence budget | `src/cli/handlers/orchestration.ts` | lines 12-16 |
| Heartbeats are written to stderr (not stdout) so stdout stays clean for JSON output | `src/cli/handlers/orchestration.ts` | lines 129-131 |
| JSON-shaped heartbeats (`{"_heartbeat":true}`) allow filtering with `jq` | `src/cli/handlers/orchestration.ts` | line 131 |
| `--wait` long-polls extend client-side socket timeout with 10 s grace over `timeoutMs` | `src/cli/runtime/client.ts` | lines 91-102 |

**7. RPC Transport: Named Pipe + Heartbeat Framing**

The CLI communicates with the Orca runtime over a Unix domain socket (named pipe on Windows). The transport reads JSON frames line-by-line, ignoring interleaved `_keepalive` frames during long-poll operations, and refreshes the client-side timeout on each keepalive.

| Claim | Source | Location |
|-------|--------|----------|
| Transport is Unix domain socket / named pipe, selected from runtime metadata | `src/cli/runtime/transport.ts` | line 14 |
| `_keepalive` frames refresh the client-side timeout to prevent 60 s ceiling from firing before server resolves | `src/cli/runtime/transport.ts` | lines 71-75, 103-107 |
| Long-poll methods get extended client socket timeout: `max(timeoutMs + 10s, 60s)` | `src/cli/runtime/client.ts` | lines 91-102 |
| Runtime metadata includes auth token passed on the wire in each request | `src/cli/runtime/transport.ts` | lines 161-168 |

**8. Agent Status Orchestration Context**

When an agent pane is spawned by a coordinator, Orca carries orchestration context on the agent status entry so the renderer can display dispatch hierarchy.

| Claim | Source | Location |
|-------|--------|----------|
| `AgentStatusOrchestrationContext` carries `taskId`, `dispatchId`, `parentTerminalHandle`, `parentPaneKey`, `coordinatorHandle`, `orchestrationRunId` | `src/shared/agent-status-types.ts` | lines 55-62 |
| Orchestration context is pane-level state, not worktree lineage | `src/shared/agent-status-types.ts` | lines 99-101 |

**9. CLI Command Dispatch Architecture**

Handlers are grouped by domain (orchestration, terminal, browser, etc.) into a flat `Map<string, CommandHandler>`. The `dispatch` function joins the command path array and looks up the handler. Duplicate registration throws an error.

| Claim | Source | Location |
|-------|--------|----------|
| Handler groups registered in order: core, automations, repo, worktree, terminal, browser-*, orchestration, computer, environment | `src/cli/dispatch.ts` | lines 31-48 |
| `dispatch(commandPath.join(' '))` is a simple map lookup | `src/cli/dispatch.ts` | lines 62-68 |
| `HandlerContext` provides `flags`, `client`, `cwd`, `json` to every handler | `src/cli/dispatch.ts` | lines 20-25 |

**10. Terminal Resolution and Worktree Auto-Selection**

When `--terminal` is omitted, Orca auto-resolves to the active terminal in the current worktree. Browser commands auto-resolve from `cwd`. Remote CLI disallows cwd-derived selectors since cwd belongs to the client machine.

| Claim | Source | Location |
|-------|--------|----------|
| `getTerminalHandle` auto-resolves active terminal when `--terminal` omitted | `src/cli/selectors.ts` | lines 142-154 |
| `resolveCurrentWorktreeSelector` finds the deepest enclosing managed worktree from shell cwd | `src/cli/selectors.ts` | lines 50-76 |
| Remote CLI throws if `active`/`current` selector is used (local cwd shortcut invalid for remote) | `src/cli/selectors.ts` | lines 30-39 |
| `terminal create` creates background session unless `--focus` is explicit | `skills/orca-cli/SKILL.md` | line 219 |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Skills split by scope: `orchestration` for agent-to-agent; `orca-cli` for terminal/worktree/browser control | `skills/orchestration/SKILL.md` | lines 1-17; `skills/orca-cli/SKILL.md` | lines 1-17 |
| Preamble injection teaches `worker_done` pattern | `skills/orchestration/SKILL.md` | line 96; `src/cli/handlers/orchestration.ts` | lines 276-303 |
| Heartbeat written line-by-line to stderr for non-blocking parent detection | `src/cli/handlers/orchestration.ts` | lines 34-52 |
| Long-poll timeout grace: 10 s over `timeoutMs` for client socket | `src/cli/runtime/client.ts` | lines 22, 98 |
| `ORCA_TERMINAL_HANDLE` env var is the auto-resolution source for `--from` | `src/cli/handlers/orchestration.ts` | line 85 |
| Agent status types include `orchestration` context for parent-child hierarchy | `src/shared/agent-status-types.ts` | lines 55-62, 101 |
| Coordinator loop runs in background with phases: decomposing → dispatching → monitoring → merging → done | `skills/orchestration/SKILL.md` | line 128 |

### Risks / Unknowns

- **[!]** Orca's orchestration uses a running Orca runtime as the RPC server — Stoa would need its own RPC transport layer. Orca's named-pipe transport and metadata bootstrapping are tightly coupled to Orca's runtime startup.
- **[!]** Terminal handles are runtime-scoped. Orca restarts invalidate all handles. Any coordination system that stores terminal references must handle handle staleness gracefully.
- **[?]** Whether Orca's message store schema is published/stable — not explicitly documented in skills or CLI specs. May need to reverse-engineer or treat as internal.
- **[?]** Whether the `worker_done` preamble content (the exact text that teaches agents to report back) is documented or just implicit in the source. The skill says it "teaches" agents but doesn't reproduce the preamble.
- **[?]** The coordinator loop (`orchestration run`) runs in the Orca runtime, not as a separate process. Stoa would need to implement its own coordinator if it wants automated task advancement.

### Open Questions

1. **Preamble contract**: What exactly does the injected preamble say to the agent? This determines how portable the `worker_done` convention is outside Orca.
2. **Staleness detection**: How does Orca detect a stale terminal handle? Is there a `terminal_handle_stale` error code, or does it just return `null`/`not_found`?
3. **Remote runtime**: For remote Paired CLI sessions, how does orchestration work when the coordinator is local but workers are remote? The `isRemote` flag gates cwd-derived selectors, but what about message delivery?
4. **Decision gates on remote**: Do decision gates (`gate-create`) work over remote pairings, or only in local runtime sessions?

---

**Report Path:** `research/2026-05-29-orca-orchestration-patterns-subagent.md`