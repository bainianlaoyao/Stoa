---
date: 2026-05-29
topic: stoa-ctl and metasession current architecture
status: completed
mode: context-gathering
sources: 18
---

## Context Report: stoa-ctl and MetaSession Architecture

### Why This Was Gathered

Supports a planned design change to expose stoa-ctl to all sessions (not just a separate metasession). Need to understand current boundaries so the change touches the right seams.

### Summary

`stoa-ctl` is a standalone Node CLI that talks to an Express HTTP control server embedded in the Electron main process. The control server lives behind a `/ctl` prefix and is authenticated via session ID headers and an optional secret. A "meta session" is a first-class entity — a container for an AI agent (Claude Code, Codex, OpenCode) that orchestrates work sessions. The meta session's bootstrap prompt instructs the agent to use `stoa-ctl` as its discovery and control interface. The CLI, control server, dispatcher, proposal store, and renderer store are all coupled to the meta-session identity model.

### Key Findings

#### 1. stoa-ctl Entrypoints and Command Model

**CLI entrypoint**: `tools/stoa-ctl/index.ts`
- Single `run(argv, deps)` function that parses `[group] [action]` commands and dispatches HTTP requests to the control server.
- Global flag `--session <id>` overrides which meta session to target (line 116-126).
- Session identity is resolved via `STOA_META_SESSION_ID` / `STOA_SESSION_ID` env vars, then `--session` flag, then the active meta session ID from the port file (line 93-101).
- Auto-executes when `isDirectCliEntry()` detects direct invocation (line 757-760).

**Command groups** (lines 41-77):
| Group | Actions |
|-------|---------|
| (root) | `health`, `bootstrap-prompt`, `whoami`, `capabilities` |
| `state` | `brief`, `attention-queue`, `conflicts` |
| `work-sessions` | `list`, `create`, `get`, `events`, `context`, `archive`, `prompt`, `send-keys` |
| `meta-sessions` | `list`, `create`, `get`, `archive`, `restore`, `activate` |
| `proposals` | `list`, `create`, `get`, `wait` |
| `dispatch` | `preset`, `proposal` |

**Build pipeline**: `scripts/build-stoa-ctl.mjs` — Vite bundles `tools/stoa-ctl/index.ts` to `out/tools/stoa-ctl/index.mjs` with path aliases (`@core`, `@shared`, `@extensions`).

**Shim layer**: `src/core/stoa-ctl-shim.ts` — Generates platform-specific wrapper scripts (`.cmd` for Windows, bash for POSIX) that invoke the bundled CLI via `ELECTRON_RUN_AS_NODE=1`. Installs to `~/.stoa/bin/` and registers in PATH.

**Port file**: `src/core/stoa-ctl-port-file.ts` — Writes `~/.stoa/ctl.json` containing `{port, pid, activeMetaSessionId, secret, startedAt}`. The CLI reads this to discover the control server.

#### 2. MetaSession Purpose and Lifecycle

**What is a meta session**: A container entity representing an AI agent that manages work sessions. It has its own lifecycle (`created → starting → running → waiting_approval → idle → failed → closed`), a backend type (`claude-code`, `codex`, `opencode`), and a capability level (0-3).

**Shared types**: `src/shared/meta-session.ts`
- `MetaSessionSummary` — the core data model (lines 13-28)
- `PersistedMetaSessionStateV1` — the on-disk format (lines 147-154)
- `MetaSessionProposal` — approval-gated prompt injection (lines 80-98)
- `CreateMetaSessionRequest` — creation input (lines 183-187)

**Manager**: `src/core/meta-session-manager.ts`
- CRUD for meta sessions, persists to `~/.stoa/meta-session.json` via `meta-session-state-store.ts`
- Tracks `activeMetaSessionId` (only one active at a time)
- Manages inspector target (which entity the UI is focused on)
- `buildBootstrapRecoveryPlan()` identifies sessions that need recovery on restart

**Bootstrap prompt**: `src/core/meta-session-bootstrap-prompt.ts`
- The text prompt injected into the meta session's AI agent
- Instructs the agent to use `stoa-ctl` for all discovery/control
- Defines a "DISCOVERY SEQUENCE": `whoami → capabilities → state brief → work-sessions list`
- Enforces that the agent must fetch context before summarizing sessions

**Command env**: `src/core/meta-session-command-env.ts`
- Sets `STOA_META_SESSION=1`, `STOA_META_SESSION_ID`, `STOA_SESSION_ID`, `STOA_CTL_BASE_URL`, `STOA_CTL_COMMAND`, and prepends stoa-ctl bin dir to PATH
- This is the environment injected into the meta session's PTY

#### 3. Control Server (HTTP API)

**File**: `src/core/meta-session-control-server.ts`

Express app mounted at `/ctl`. All routes require auth via `x-stoa-session-id` header or `x-stoa-secret` (lines 83-96, 164-176).

**Route map** (from the Express app):
| Route | Method | Purpose |
|-------|--------|---------|
| `/ctl/health` | GET | Liveness check |
| `/ctl/bootstrap-prompt` | GET | Returns the meta session bootstrap prompt text |
| `/ctl/whoami` | GET | Returns calling session identity |
| `/ctl/capabilities` | GET | Returns what this session can do |
| `/ctl/state/brief` | GET | All work sessions summary |
| `/ctl/state/attention-queue` | GET | Sessions needing attention, sorted by priority |
| `/ctl/state/conflicts` | GET | Conflict detection (currently returns empty) |
| `/ctl/work-sessions` | GET/POST | List or create work sessions |
| `/ctl/work-sessions/:id` | GET | Single work session status |
| `/ctl/work-sessions/:id/events` | GET | Observation events for a session |
| `/ctl/work-sessions/:id/context` | GET | Context at various levels (slim/status/bundle/full) |
| `/ctl/work-sessions/:id/archive` | POST | Archive a work session |
| `/ctl/work-sessions/:id/prompt` | POST | Send a prompt (approval-gated for freeform text) |
| `/ctl/work-sessions/:id/send-keys` | POST | Raw keystroke injection |
| `/ctl/meta-sessions` | GET/POST | List or create meta sessions |
| `/ctl/meta-sessions/:id` | GET | Single meta session |
| `/ctl/meta-sessions/:id/activate` | POST | Set as active meta session |
| `/ctl/meta-sessions/:id/archive` | POST | Archive a meta session |
| `/ctl/meta-sessions/:id/restore` | POST | Restore an archived meta session |
| `/ctl/proposals` | GET/POST | List or create proposals |
| `/ctl/proposals/:id` | GET | Single proposal |
| `/ctl/proposals/:id/approve` | POST | Approve a proposal |
| `/ctl/proposals/:id/reject` | POST | Reject a proposal |
| `/ctl/dispatch/proposal/:id` | POST | Execute an approved proposal |
| `/ctl/dispatch/preset/:name` | POST | Execute a named preset prompt |

**Server lifecycle**: Started on a random port bound to `127.0.0.1`, port written to `~/.stoa/ctl.json` (line 640-650).

#### 4. Dispatch and Proposal System

**Command dispatcher**: `src/core/meta-session-command-dispatcher.ts`
- Three dispatch modes: `promptWorkSession` (approval-gated), `sendKeysToWorkSession` (direct), `dispatchPreset` (named templates)
- `dispatchProposal()` validates snapshot freshness before executing
- Freeform prompts always require approval (creates a `MetaSessionProposal`)

**Proposal store**: `src/core/meta-session-proposal-store.ts`
- In-memory + persistent proposal lifecycle: `pending_approval → approved → executing → completed/failed`
- Stale detection via session snapshot comparison
- Action audit log persisted alongside proposals

#### 5. Renderer Layer

**Pinia store**: `src/renderer/stores/meta-session.ts`
- `useMetaSessionStore()` — manages meta sessions, proposals, inspector target
- Bootstraps from `window.stoa.getMetaSessionBootstrapState()` via preload bridge
- Actions: `createSession`, `setActiveSession`, `archiveSession`, `restoreSession`, `approveProposal`, `rejectProposal`, `approveAndDispatchProposal`, `setInspector`

**IPC channels** (`src/core/ipc-channels.ts`, lines 17-28):
- `meta-session:bootstrap`, `meta-session:create`, `meta-session:set-active`, `meta-session:archive`, `meta-session:restore`, `meta-session:event`
- `meta-session:proposal-list`, `meta-session:proposal-get`, `meta-session:proposal-approve`, `meta-session:proposal-reject`, `meta-session:proposal-dispatch`
- `meta-session:inspector-set-target`

**Provider patch**: `src/core/meta-session-provider-patch.ts`
- Derives meta session status patches from work session state change events
- Maps runtime intents (e.g. `runtime.alive`, `agent.permission_requested`) to meta session status strings

#### 6. Main Process Wiring

In `src/main/index.ts` (lines 661-718), `configureServerApp(app)`:
- Creates `MetaSessionControlServer` with `metaSessionSource`, `snapshotSource`, `contextAssembler`, `dispatcher`, `proposals`, `workSessionLifecycle`, and `ctlSecret`
- `metaSessionSource` delegates to `activeMetaSessionManager` for snapshot/get/create/set-active/archive/restore
- `snapshotSource` is the project session manager (work sessions)
- `getSessionPresence` comes from the observability service
- `workSessionLifecycle` delegates to `createWorkSessionWithRuntime` and `archiveWorkSessionWithRuntime`

### Boundary Analysis: Exposing stoa-ctl to All Sessions

If stoa-ctl is exposed to **all sessions** (not just a separate meta session), these boundaries change:

| Boundary | Current State | Impact of Change |
|----------|--------------|------------------|
| **Auth model** (`meta-session-control-server.ts:83-96`) | Authenticated via `x-stoa-session-id` (must be a known meta session) or `x-stoa-secret` | Must accept **any** session ID (work session IDs too), or remove the meta-session-only constraint |
| **Session resolution** (`tools/stoa-ctl/index.ts:93-101`) | Resolves to a meta session ID from env/flag/port file | Must resolve to **any** session, not just meta sessions. The `--session` flag semantics expand |
| **Command env** (`meta-session-command-env.ts`) | Sets `STOA_META_SESSION=1`, `STOA_META_SESSION_ID`, `STOA_SESSION_ID` | Would need variants: meta session env vs. work session env, or a unified session identity |
| **Bootstrap prompt** (`meta-session-bootstrap-prompt.ts`) | Only injected into meta sessions | Would need to be injectable into work sessions too, or a simplified variant for non-meta sessions |
| **Port file** (`stoa-ctl-port-file.ts:6-12`) | Tracks `activeMetaSessionId` | Would need to track active session ID generically (not just meta) |
| **Dispatcher** (`meta-session-command-dispatcher.ts`) | `metaSessionId` is a required field on all dispatch inputs | Must support dispatching without a meta session context, or every session must carry equivalent context |
| **Proposal store** (`meta-session-proposal-store.ts`) | Proposals are scoped to `metaSessionId` | Proposals would need to be scoped to generic session IDs |
| **IPC channels** (`ipc-channels.ts:17-28`) | All channels prefixed `meta-session:` | May need new channels or renaming if the concept generalizes |
| **Renderer store** (`stores/meta-session.ts`) | Dedicated `useMetaSessionStore()` with meta-session-specific computed props | Would need integration with the work session store, or a unified session store |
| **Context assembler** (`meta-session-context-assembler.ts`) | Takes sessions from `BootstrapState` (project session manager) | Already works on work sessions — minimal change expected |
| **Control server routes** (`meta-session-control-server.ts`) | All routes under `/ctl` assume meta session context in `x-stoa-session-id` header | Routes that need meta session context (whoami, capabilities) need generalization; work-session-only routes may work as-is |
| **Provider patch** (`meta-session-provider-patch.ts`) | Derives meta session status from work session events | Would need to work bidirectionally or for all session types |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| CLI entrypoint, command parsing, session resolution | `tools/stoa-ctl/index.ts` | lines 41-77, 82-113, 225-760 |
| Build pipeline for stoa-ctl | `scripts/build-stoa-ctl.mjs` | lines 1-39 |
| Shim generation (platform wrappers) | `src/core/stoa-ctl-shim.ts` | lines 47-74, 105-127 |
| Port file for control server discovery | `src/core/stoa-ctl-port-file.ts` | lines 1-77 |
| Meta session shared types | `src/shared/meta-session.ts` | lines 1-199 |
| Meta session CRUD manager | `src/core/meta-session-manager.ts` | lines 1-243 |
| Meta session state persistence | `src/core/meta-session-state-store.ts` | lines 1-517 |
| Bootstrap prompt (agent instructions) | `src/core/meta-session-bootstrap-prompt.ts` | lines 1-32 |
| Command env injection | `src/core/meta-session-command-env.ts` | lines 1-24 |
| HTTP control server (all routes) | `src/core/meta-session-control-server.ts` | lines 1-669 |
| Command dispatcher | `src/core/meta-session-command-dispatcher.ts` | lines 1-189 |
| Proposal store | `src/core/meta-session-proposal-store.ts` | lines 1-320 |
| Context assembler | `src/core/meta-session-context-assembler.ts` | lines 1-163 |
| Renderer Pinia store | `src/renderer/stores/meta-session.ts` | lines 1-274 |
| IPC channel names | `src/core/ipc-channels.ts` | lines 17-28 |
| Main process wiring | `src/main/index.ts` | lines 661-718 |
| Provider status patch | `src/core/meta-session-provider-patch.ts` | lines 1-136 |
| Auth middleware in control server | `src/core/meta-session-control-server.ts` | lines 83-96, 164-176 |

### Risks / Unknowns

- [!] **Auth is the hardest boundary**: The control server's `authorize()` function currently only accepts known meta session IDs. Exposing it to all sessions means either (a) every work session ID becomes a valid auth identity, or (b) auth moves to secret-only, or (c) a session-agnostic auth model is introduced.
- [!] **Proposal ownership is meta-scoped**: Proposals carry `metaSessionId`. If work sessions gain direct stoa-ctl access, the proposal model needs to handle non-meta-session owners.
- [!] **Bootstrap prompt assumes meta session role**: The prompt text explicitly says "You are running inside a Stoa meta session." and instructs using `stoa-ctl meta-sessions ...` to manage meta sessions. Work sessions would need a different or generalized prompt.
- [?] **Whether work sessions already have any stoa-ctl access**: The codebase does not show work sessions receiving `STOA_CTL_BASE_URL` or the stoa-ctl bin dir in their PATH. This appears to be meta-session-exclusive currently, but this was not exhaustively verified across all work session launch paths.
- [?] **Whether the `work-sessions` CLI commands already work for non-meta callers**: The CLI routes like `/ctl/work-sessions` read from `snapshotSource` (the project session manager), which is session-agnostic. The auth gate is the only barrier. This needs explicit verification.
- [?] **How many test files would need updating**: The test suite has `meta-session` in filenames for 15+ files. If the naming generalizes, many test imports would change.

### Context Handoff: stoa-ctl and MetaSession Architecture

Start here: `research/2026-05-29-stoa-ctl-current-architecture.md`

Context only. Use the saved report as the source of truth.
