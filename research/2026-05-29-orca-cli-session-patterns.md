---
date: 2026-05-29
topic: orca-cli-session-patterns
status: completed
mode: context-gathering
sources: 24
---

## Context Report: Orca CLI / Session Lifecycle / Subagent Control Patterns

### Why This Was Gathered

Support design work for `stoa-ctl` session/subagent control and frontend synchronization by extracting reusable upstream patterns from Orca's CLI, terminal/session lifecycle, orchestration flow, inspect primitives, and UI sync model without modifying upstream.

### Summary

Orca's upstream separates concerns into a flat CLI command surface, a runtime RPC layer, a daemon-owned PTY/session layer, and a renderer-owned UI/session state layer. The reusable patterns are: flat command registration with centralized formatting, long-poll RPC with keepalive-aware timeouts, runtime-scoped handle-based terminal control, explicit worker messaging/preamble contracts for subagents, and a frontend that treats authoritative runtime scans separately from visible UI state. Within the reviewed CLI spec and handler surface, I did not find a dedicated top-level `session` command group; the reviewed lifecycle control is carried mainly by `worktree`, `terminal`, orchestration, and renderer session persistence paths (`research/upstreams/orca/src/cli/specs/index.ts:10-18`, `research/upstreams/orca/src/cli/dispatch.ts:29-47`).

### Key Findings

#### 1. CLI command shape is flat, typed, and centrally formatted

- Orca declares commands as static domain `CommandSpec[]` arrays and merges them into one `COMMAND_SPECS` registry. Dispatch is a flat `Map<string, CommandHandler>` keyed by the joined command path, with duplicate registration rejected at startup (`research/upstreams/orca/src/cli/specs/index.ts:10-18`, `research/upstreams/orca/src/cli/dispatch.ts:29-68`).
- `CommandSpec` is intentionally small: `path`, `summary`, `usage`, `allowedFlags`, and optional `positionalArgs`/examples/notes. Global flags are inherited through `GLOBAL_FLAGS`, and positional arguments can be normalized into flag entries before validation (`research/upstreams/orca/src/cli/args.ts:9-19`, `research/upstreams/orca/src/cli/args.ts:109-134`).
- Human and machine output share one result path. `printResult()` prints either formatted human output or the JSON RPC envelope, and CLI error rewriting is centralized in `formatCliError()` / `reportCliError()` (`research/upstreams/orca/src/cli/format.ts:42-101`).
- JSON mode preserves runtime metadata and trims oversized payloads. Screenshot results are rewritten to file paths plus expiry metadata instead of returning inline base64 blobs (`research/upstreams/orca/src/cli/format.ts:482-511`).

#### 2. RPC and selector patterns assume long waits and runtime-scoped identity

- `RuntimeClient.call()` switches between local transport and remote pairing transport. Long-poll methods extend the client timeout beyond the default request budget by adding a grace window for `orchestration.check --wait` and `terminal.wait` (`research/upstreams/orca/src/cli/runtime/client.ts:16-22`, `research/upstreams/orca/src/cli/runtime/client.ts:50-102`).
- Local transport is newline-delimited JSON over a named pipe / Unix socket selected from runtime metadata. `_keepalive` frames refresh the client-side timeout, and the client rejects mismatched request IDs or changed `runtimeId` values mid-flight (`research/upstreams/orca/src/cli/runtime/transport.ts:14-41`, `research/upstreams/orca/src/cli/runtime/transport.ts:69-168`).
- Worktree and terminal targeting follow selector-resolution helpers instead of being open-coded in handlers. `active` / `current` are resolved from local `cwd`, browser commands default to current worktree locally but not remotely, and `getTerminalHandle()` resolves the active terminal when `--terminal` is omitted (`research/upstreams/orca/src/cli/selectors.ts:23-27`, `research/upstreams/orca/src/cli/selectors.ts:50-76`, `research/upstreams/orca/src/cli/selectors.ts:109-154`).

#### 3. Session and terminal lifecycle are split across IDs, daemon ownership, and persistence boundaries

- Worktree identity is composite, not opaque: `splitWorktreeId()` parses `${repoId}::${absolutePath}`, while `splitWorktreeIdForFilesystem()` strips folder-workspace suffixes for filesystem callers (`research/upstreams/orca/src/shared/worktree-id.ts:20-43`).
- PTY session IDs embed worktree identity as `${worktreeId}@@${shortUuid}` when minted with a worktree, and Orca validates the derived filesystem path to keep overlay state contained under `userData` (`research/upstreams/orca/src/main/daemon/pty-session-id.ts:21-68`).
- `TerminalHost` is the live PTY source of truth. It owns the in-memory `sessions` map, reattaches only to alive non-terminating sessions, clears tombstones on recreate, and writes final checkpoints before force-killing live sessions during shutdown (`research/upstreams/orca/src/main/daemon/terminal-host.ts:55-141`, `research/upstreams/orca/src/main/daemon/terminal-host.ts:223-260`).
- The `Session` object maintains shell-ready state, queues input written before shell readiness, and exposes separate teardown paths for natural dispose, force-kill, and fd-release-only cleanup after exit (`research/upstreams/orca/src/main/daemon/session.ts:43-55`, `research/upstreams/orca/src/main/daemon/session.ts:194-268`, `research/upstreams/orca/src/main/daemon/session.ts:370-380`).
- Renderer-side workspace persistence is gated. Orca only persists when both `workspaceSessionReady` and `hydrationSucceeded` are true, uses an explicit list of session-relevant fields with a compile-time exhaustiveness guard, and strips transient `pendingActivationSpawn` before writing the session payload (`research/upstreams/orca/src/renderer/src/lib/workspace-session.ts:24-28`, `research/upstreams/orca/src/renderer/src/lib/workspace-session.ts:63-94`, `research/upstreams/orca/src/renderer/src/lib/workspace-session.ts:192-277`).
- Scrollback ownership is intentionally split by connection type. Local terminal scrollback buffers are pruned from persisted session JSON because the daemon is authoritative; remote/SSH buffers stay in the persisted layout because relay teardown may leave no local history to restore (`research/upstreams/orca/src/shared/workspace-session-terminal-buffers.ts:37-77`).

#### 4. Subagent control is a message-and-task protocol, not implicit terminal scraping

- Orca stores orchestration state in SQLite with explicit tables for `messages`, `tasks`, `dispatch_contexts`, `decision_gates`, and `coordinator_runs`. Message types and task/dispatch statuses are schema-constrained in the database (`research/upstreams/orca/src/main/runtime/orchestration/db.ts:42-117`).
- Orchestration send/dispatch RPCs enforce specific control patterns. Group addresses fan out into one message per recipient with shared `thread_id`, and `dispatch --inject` is rejected unless the target terminal is already running a recognized agent CLI (`research/upstreams/orca/src/main/runtime/rpc/methods/orchestration.ts:146-191`, `research/upstreams/orca/src/main/runtime/rpc/methods/orchestration.ts:413-450`).
- The dispatch preamble is a first-class protocol artifact. It tells workers to report `worker_done` exactly once, send periodic heartbeats keyed by both `taskId` and `dispatchId`, use `orchestration ask` instead of local interactive prompts, and keep the shell alive for follow-up polling after completion (`research/upstreams/orca/src/main/runtime/orchestration/preamble.ts:33-133`).
- CLI orchestration commands include their own liveness behavior. `orchestration.check --wait` emits structured stderr heartbeats every 15 seconds, `ORCA_TERMINAL_HANDLE` is used for implicit sender resolution, and `orchestration ask --json` deliberately bypasses the normal RPC envelope to emit a single JSON object suitable for piping (`research/upstreams/orca/src/cli/handlers/orchestration.ts:12-16`, `research/upstreams/orca/src/cli/handlers/orchestration.ts:34-52`, `research/upstreams/orca/src/cli/handlers/orchestration.ts:81-90`, `research/upstreams/orca/src/cli/handlers/orchestration.ts:128-145`, `research/upstreams/orca/src/cli/handlers/orchestration.ts:276-345`).
- Renderer-visible agent hierarchy is pane-level orchestration context, not worktree lineage. Orca keeps `taskId`, `dispatchId`, parent handles, and coordinator linkage on agent status entries (`research/upstreams/orca/src/shared/agent-status-types.ts:55-62`, `research/upstreams/orca/src/shared/agent-status-types.ts:99-101`).

#### 5. Inspect and prompt primitives are explicit RPCs with bounded reads

- Terminal inspection is built from `terminal.show`, `terminal.read`, `terminal.send`, and `terminal.wait`. `terminal.read` uses cursor-based bounded reads, `terminal.send` reports accepted bytes, and `terminal.wait` can fail the process when the wait condition is not satisfied (`research/upstreams/orca/src/cli/handlers/terminal.ts:41-111`, `research/upstreams/orca/src/shared/runtime-types.ts:280-330`).
- RPC envelopes are shared across CLI and runtime clients. Success, failure, and keepalive frames are validated through `RuntimeRpcEnvelopeSchema`, and success envelopes always carry `runtimeId` (`research/upstreams/orca/src/shared/runtime-rpc-envelope.ts:1-50`).
- There is no separate prompt-construction API in the reviewed surface. The reviewed prompt/control model is plain-text preamble injection plus typed orchestration messages and terminal send/read primitives (`research/upstreams/orca/src/main/runtime/orchestration/preamble.ts:33-133`, `research/upstreams/orca/src/cli/handlers/orchestration.ts:276-345`).

#### 6. Frontend synchronization uses an authoritative-vs-visible split

- The renderer state model is a single Zustand store composed from many slices, with selector-level WeakMap caching to deduplicate hot-path projections on immutable slice replacements (`research/upstreams/orca/src/renderer/src/store/index.ts:1-61`, `research/upstreams/orca/src/renderer/src/store/selectors.ts:17-39`).
- Orca keeps two worktree layers in state: `worktreesByRepo` for visible UI state and `detectedWorktreesByRepo` for authoritative scan results. When authoritative scans indicate deletions, Orca diffs before/after IDs and purges worktree-scoped terminal/editor/browser/git state (`research/upstreams/orca/src/renderer/src/store/slices/worktrees.ts:436-564`, `research/upstreams/orca/src/renderer/src/store/slices/worktrees.ts:566-592`, `research/upstreams/orca/src/renderer/src/hooks/useIpcEvents.ts:545-582`).
- Hydration includes a one-shot stale-state purge and first-activation tagging. `fetchAllWorktrees()` waits for authoritative scans before purging persisted stale worktree state, and first activation marks tabs with `pendingActivationSpawn` for controlled PTY reattachment behavior (`research/upstreams/orca/src/renderer/src/store/slices/worktrees.ts:654-730`, `research/upstreams/orca/src/renderer/src/store/slices/worktrees.ts:1815-1830`).
- Sync is mostly event-driven but not purely push-based. Main-to-renderer worktree/repo updates come from centralized IPC subscriptions, git status is polled every 3 seconds with coalescing, agent freshness is driven by a single timer scheduler, and startup orders settings -> repos -> worktrees -> session hydration to avoid loading stale local state under a persisted remote runtime (`research/upstreams/orca/src/renderer/src/hooks/useIpcEvents.ts:350-394`, `research/upstreams/orca/src/renderer/src/hooks/useIpcEvents.ts:520-582`, `research/upstreams/orca/src/renderer/src/components/right-sidebar/useGitStatusPolling.ts:12-118`, `research/upstreams/orca/src/renderer/src/store/slices/agent-status-freshness-scheduler.ts:19-69`, `research/upstreams/orca/src/renderer/src/App.tsx:523-545`).

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Command domains are merged into one CLI registry | `research/upstreams/orca/src/cli/specs/index.ts` | `10-18` |
| Dispatch uses a flat handler map with duplicate detection | `research/upstreams/orca/src/cli/dispatch.ts` | `29-68` |
| `CommandSpec` shape and global flags | `research/upstreams/orca/src/cli/args.ts` | `9-19` |
| Positional arguments normalize into flags | `research/upstreams/orca/src/cli/args.ts` | `109-134` |
| `printResult`, error formatting, JSON error reporting | `research/upstreams/orca/src/cli/format.ts` | `42-101` |
| JSON screenshot rewriting keeps payloads bounded | `research/upstreams/orca/src/cli/format.ts` | `482-511` |
| Runtime client chooses local vs remote transport and widens long-poll timeouts | `research/upstreams/orca/src/cli/runtime/client.ts` | `16-22`, `50-102` |
| Local RPC transport uses NDJSON, keepalives, request IDs, and `runtimeId` validation | `research/upstreams/orca/src/cli/runtime/transport.ts` | `14-41`, `69-168` |
| Worktree and terminal selectors auto-resolve from `cwd` / active terminal | `research/upstreams/orca/src/cli/selectors.ts` | `23-27`, `50-76`, `109-154` |
| Worktree IDs are composite and filesystem parsing strips folder-session suffixes | `research/upstreams/orca/src/shared/worktree-id.ts` | `20-43` |
| PTY session IDs embed worktree IDs and are path-safety checked | `research/upstreams/orca/src/main/daemon/pty-session-id.ts` | `21-68` |
| `TerminalHost` owns live sessions and shutdown checkpoint behavior | `research/upstreams/orca/src/main/daemon/terminal-host.ts` | `55-141`, `223-260` |
| `Session` owns shell-ready buffering and separate teardown paths | `research/upstreams/orca/src/main/daemon/session.ts` | `43-55`, `194-268`, `370-380` |
| Workspace-session persistence is gated and strips transient spawn markers | `research/upstreams/orca/src/renderer/src/lib/workspace-session.ts` | `24-28`, `63-94`, `192-277` |
| Local terminal scrollback is pruned from persisted state | `research/upstreams/orca/src/shared/workspace-session-terminal-buffers.ts` | `37-77` |
| Worktree purge removes worktree-scoped terminal/editor/browser/git state | `research/upstreams/orca/src/renderer/src/store/slices/worktrees.ts` | `436-564` |
| Visible vs authoritative worktree state is tracked separately | `research/upstreams/orca/src/renderer/src/store/slices/worktrees.ts` | `566-592` |
| Hydration-time authoritative scan gates stale worktree purge | `research/upstreams/orca/src/renderer/src/store/slices/worktrees.ts` | `654-730` |
| First activation tags tabs with `pendingActivationSpawn` | `research/upstreams/orca/src/renderer/src/store/slices/worktrees.ts` | `1815-1830` |
| Orchestration state is persisted in SQLite tables with constrained statuses | `research/upstreams/orca/src/main/runtime/orchestration/db.ts` | `42-117` |
| Group messaging fan-out and inject guard live in orchestration RPC methods | `research/upstreams/orca/src/main/runtime/rpc/methods/orchestration.ts` | `146-191`, `413-450` |
| Worker preamble defines `worker_done`, heartbeat, ask, escalation, and post-completion polling rules | `research/upstreams/orca/src/main/runtime/orchestration/preamble.ts` | `33-133` |
| CLI orchestration waits emit heartbeats and `ask --json` bypasses the normal envelope | `research/upstreams/orca/src/cli/handlers/orchestration.ts` | `12-16`, `34-52`, `81-90`, `128-145`, `276-345` |
| Agent orchestration context is pane-level metadata | `research/upstreams/orca/src/shared/agent-status-types.ts` | `55-62`, `99-101` |
| Terminal inspect/send/wait primitives and shared terminal result types | `research/upstreams/orca/src/cli/handlers/terminal.ts`, `research/upstreams/orca/src/shared/runtime-types.ts` | `41-111`; `280-330` |
| RPC envelope schema defines success, failure, and keepalive frames | `research/upstreams/orca/src/shared/runtime-rpc-envelope.ts` | `1-50` |
| Renderer store composition and selector caching | `research/upstreams/orca/src/renderer/src/store/index.ts`, `research/upstreams/orca/src/renderer/src/store/selectors.ts` | `1-61`; `17-39` |
| Remote snapshot apply, IPC-driven worktree sync, and diff-based purge | `research/upstreams/orca/src/renderer/src/hooks/useIpcEvents.ts` | `350-394`, `520-582` |
| Git polling, freshness scheduling, and startup hydration order | `research/upstreams/orca/src/renderer/src/components/right-sidebar/useGitStatusPolling.ts`, `research/upstreams/orca/src/renderer/src/store/slices/agent-status-freshness-scheduler.ts`, `research/upstreams/orca/src/renderer/src/App.tsx` | `12-118`; `19-69`; `523-545` |

### Risks / Unknowns

- [?] Within the reviewed CLI spec and handler surface, I did not find a dedicated `session` command group. Unknown whether Orca exposes additional session-specific control elsewhere outside the reviewed files (`research/upstreams/orca/src/cli/specs/index.ts:10-18`, `research/upstreams/orca/src/cli/dispatch.ts:29-47`).
- [?] The reviewed upstream clearly defines preamble text and message/task protocols, but it does not establish a separate reusable prompt-builder API. Unknown whether any higher-level prompt composition helper exists outside the reviewed surface (`research/upstreams/orca/src/main/runtime/orchestration/preamble.ts:33-133`).
- [?] The reviewed renderer sync path shows Zustand + IPC + targeted polling. Unknown whether other unreviewed surfaces in Orca use a different synchronization cache model.
- [!] Terminal handles are runtime-scoped and become stale across Orca restarts, so any consumer that persists handles needs explicit re-resolution rather than assuming durable identity (`research/upstreams/orca/src/cli/selectors.ts:142-153`, `research/upstreams/orca/src/shared/runtime-types.ts:280-304`).
- [!] Worktree/session source of truth is intentionally split: daemon for live PTY/scrollback, renderer/main persistence for layout and workspace session. Reusing the pattern requires preserving that ownership boundary; collapsing it would change the failure and recovery model (`research/upstreams/orca/src/main/daemon/terminal-host.ts:223-260`, `research/upstreams/orca/src/shared/workspace-session-terminal-buffers.ts:69-76`, `research/upstreams/orca/src/renderer/src/lib/workspace-session.ts:24-28`).

## Context Handoff: Orca CLI / Session Lifecycle / Subagent Control Patterns

Start here: `research/2026-05-29-orca-cli-session-patterns.md`

Context only. Use the saved report as the source of truth.
