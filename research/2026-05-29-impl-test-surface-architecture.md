---
date: 2026-05-29
topic: impl-test-surface-architecture
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Session/Meta-Session Model — Test Surface Architecture

### Why This Was Gathered

Bounded architecture trace for current session/meta-session model that drives the test surface. Enables precise judgment of downstream test impact when modifying session structures.

### Summary

The codebase implements a two-tier session model: **work sessions** (traditional project-scoped sessions, persisted per-project in `sessions.json`) and **meta sessions** (orchestration layer with proposals, persisted separately in `meta-session.json`). Both are exposed through typed IPC channels and read models. Tests couple to enum values, field shapes, IPC channel names, and disk formats across multiple state stores.

### Key Findings

**1. Two parallel session hierarchies coexist**

- **Work sessions** (`SessionSummary` → `PersistedSession`): project-scoped, stored in `<project>/.stoa/sessions.json` via `PersistedProjectSessions` (version 6) in `src/shared/project-session.ts:259-263`.
- **Meta sessions** (`MetaSessionSummary` → `PersistedMetaSession`): global, stored in `~/.stoa/meta-session.json` via `PersistedMetaSessionStateV1` in `src/shared/meta-session.ts:147-154`.

**2. Persistence layer has three state files**

| File | Location | Type | Source |
|------|----------|------|--------|
| `~/.stoa/global.json` | Per-user | `PersistedGlobalStateV4` | `src/core/state-store.ts:28-34` |
| `<project>/.stoa/sessions.json` | Per-project | `PersistedProjectSessions` | `src/core/state-store.ts:36-40` |
| `~/.stoa/meta-session.json` | Per-user | `PersistedMetaSessionStateV1` | `src/core/meta-session-state-store.ts:7-16` |

**3. Meta-session state store is completely separate from session state store**

`src/core/meta-session-state-store.ts` is an independent implementation with its own atomic-write, validation, and normalization logic. It does not share code with `src/core/state-store.ts`.

**4. Work session persistence is fully per-project**

`src/core/state-store.ts:369-408` reads `sessions.json` per project path. `src/core/state-store.ts:422-430` aggregates across all projects via `readAllProjectSessions`.

**5. IPC channel surface is split between work-session and meta-session namespaces**

Work-session channels: `project:*`, `session:*`, `terminal:*`, `workspace:*`, `observability:*`
Meta-session channels: `meta-session:*`
Source: `src/core/ipc-channels.ts:1-95`

**6. RendererApi uses optional chaining for meta-session methods**

`src/shared/project-session.ts:385-396`: `getMetaSessionBootstrapState?`, `createMetaSession?`, `setActiveMetaSession?`, etc. are all optional. Tests must account for potential absence (`tests/e2e/app-bridge-guard.test.ts` covers undefined/partially-defined cases).

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Work-session read model | `src/shared/project-session.ts` | lines 113-152 (SessionSummary) |
| Work-session disk format | `src/shared/project-session.ts` | lines 163-186 (PersistedSession) |
| BootstrapState (work-session) | `src/shared/project-session.ts` | lines 265-271 |
| PersistedGlobalStateV4 shape | `src/shared/project-session.ts` | lines 251-257 |
| PersistedProjectSessions shape | `src/shared/project-session.ts` | lines 259-263 |
| toSessionSummary transformer | `src/core/project-session-manager.ts` | lines 89-114 |
| toPersistedSession transformer | `src/core/project-session-manager.ts` | lines 62-87 |
| Meta-session read model | `src/shared/meta-session.ts` | lines 13-28 (MetaSessionSummary) |
| Meta-session disk format | `src/shared/meta-session.ts` | lines 30-45 (PersistedMetaSession) |
| MetaSessionBootstrapState | `src/shared/meta-session.ts` | lines 177-181 |
| PersistedMetaSessionStateV1 | `src/shared/meta-session.ts` | lines 147-154 |
| Meta-session state store | `src/core/meta-session-state-store.ts` | lines 1-517 (entire file) |
| Work-session state store | `src/core/state-store.ts` | lines 1-459 (entire file) |
| IPC channel constants | `src/core/ipc-channels.ts` | lines 1-95 |
| Meta-session IPC handlers (main) | `src/main/index.ts` | lines 1556-1653 |
| Meta-session test channels list | `tests/e2e/ipc-bridge.test.ts` | lines 63-90 |
| App-bridge guard (optional meta) | `tests/e2e/app-bridge-guard.test.ts` | entire file |
| Config guard (IPC static analysis) | `tests/e2e/main-config-guard.test.ts` | entire file |

### Field-Level Test Couplings

**PersistedSession coupling** (validated field-by-field in `src/core/state-store.ts:145-187`):
- `session_id`, `project_id` (string)
- `type` must be one of: `'shell'`, `'opencode'`, `'codex'`, `'claude-code'` (line 150)
- `runtime_state` must be one of: `'created'`, `'starting'`, `'alive'`, `'exited'`, `'failed_to_start'` (line 152)
- `turn_state` must be one of: `'idle'`, `'running'` (line 153)
- `last_turn_outcome` must be one of: `'none'`, `'completed'`, `'interrupted'`, `'cancelled'`, `'failed'` (line 155)
- `blocking_reason` nullable enum (line 156)
- `failure_reason` nullable enum (lines 157-174)
- `recovery_mode` must be one of: `'fresh-shell'`, `'resume-external'` (line 185)

**PersistedMetaSession coupling** (validated in `src/core/meta-session-state-store.ts:74-105`):
- `status` must be one of: `'created'`, `'starting'`, `'running'`, `'waiting_approval'`, `'idle'`, `'failed'`, `'closed'` (lines 58-66)
- `backend_session_type` must be one of: `'claude-code'`, `'codex'`, `'opencode'` (lines 68-72)
- `capability_level` must be one of: `0`, `1`, `2`, `3` (line 54-55)
- All other fields typed with basic type checks

**Proposal status values** (lines 192-200):
- `'pending_approval'`, `'approved'`, `'rejected'`, `'executing'`, `'completed'`, `'failed'`, `'stale'`

### Disk Path Assumptions in Tests

| Path | Source |
|------|--------|
| `~/.stoa/state.json` | `src/core/state-store.ts:42-43` (now unused — global.json is current) |
| `~/.stoa/global.json` | `src/core/state-store.ts:46-48` |
| `~/.stoa/meta-session.json` | `src/core/meta-session-state-store.ts:18-24` |
| `<project>/.stoa/sessions.json` | `src/core/state-store.ts:50-52` |

Tests create temp directories and pass explicit paths to `createTestWorkspace` / `createTestGlobalStatePath` (see `tests/e2e/helpers.ts`).

### Risks / Unknowns

- [!] **Dual persistence paths**: The codebase migrated from single `state.json` (PersistedAppStateV2) to `global.json` + per-project `sessions.json` + `meta-session.json`. Legacy `state.json` read logic (`readPersistedState`, line 317-338) is still present but appears unused by current flows. Impact on tests if this path is reactivated is unverified.
- [?] **Optional RendererApi methods**: Meta-session IPC is gated behind optional methods. Tests in `app-bridge-guard.test.ts` cover undefined, but edge cases around the async boundary (method exists but handler missing) are less covered.
- [!] **Normalization side-effects**: `toNormalizedMetaSessionState` (line 382-440) silently drops invalid sessions/proposals/action_logs on load. Tests create valid data so this path is exercised only in error-recovery scenarios.
- [?] **Two meta-session stores?** There's evidence of `MetaSessionStateStore` class in tests (`tests/e2e/ipc-bridge.test.ts:4` imports it). Need to check if there's a runtime wrapper class that `meta-session-state-store.ts` doesn't contain.