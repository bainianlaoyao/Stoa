---
date: 2026-05-29
topic: backend-unified-session-control-plane-seams
status: completed
mode: context-gathering
sources: 6 evidence items
---

## Context Report: Backend Unified Session Control Plane Seams

### Why This Was Gathered
Implementation planning for replacing meta-session control plane with unified session control plane per `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`.

### Summary
The current implementation has 6 seams where meta-session control plane must be replaced with unified session control plane. Each seam has specific code locations, current behavior, and required changes.

### Key Findings

1. **CLI Command Structure Seam** (`tools/stoa-ctl/index.ts`)
   - Current: Separate `meta-sessions` and `work-sessions` command groups
   - Target: Unify into single `session` command group with `create/inspect/prompt/destroy`
   - Critical: `resolveHeaders()` at line 93-113 uses `STOA_META_SESSION_ID` and `activeMetaSessionId` fallback — this must become unified session caller auth

2. **HTTP Control Server Seam** (`src/core/meta-session-control-server.ts`)
   - Current: Separate `/ctl/meta-sessions/*`, `/ctl/proposals/*`, `/ctl/dispatch/*` endpoints
   - Target: Replace with unified `/ctl/session/*` endpoints
   - Critical: `authorize()` at line 83-96 checks `metaSessionSource.getSession()` — must become unified `SessionCallerAuthRegistry`

3. **Command Environment Seam** (`src/core/meta-session-command-env.ts`)
   - Current: `STOA_META_SESSION: '1'`, `STOA_META_SESSION_ID` (lines 17-18)
   - Target: Remove meta-session env vars, add `STOA_CTL_SESSION_TOKEN` for new token-based auth
   - Critical: Must inject `stoa-ctl` into ALL sessions, not just meta sessions

4. **Bootstrap Prompt Seam** (`src/core/meta-session-bootstrap-prompt.ts`)
   - Current: "You are running inside a Stoa meta session" (line 2)
   - Target: Replace with unified session identity + tree-local visibility rules
   - Critical: `stoa-ctl meta-sessions ...` (line 28) → `stoa-ctl session ...`

5. **Main Process Lifecycle Seam** (`src/main/index.ts`)
   - Current: `MetaSessionManager`, `MetaSessionProposalStore`, `MetaSessionCommandDispatcher` as separate instances (lines 13-18)
   - Target: Replace with unified `SessionSupervisor`
   - Current: `launchMetaSessionRuntimeWithGuard()` (line 848-1015) vs `launchSessionRuntimeWithGuard()` (line 787-842)
   - Target: Merge into single session launch path with unified env injection
   - Current: `metaSessionBootstrapPending` set (line 70) for OpenCode bootstrap
   - Target: Remove — bootstrap prompt is unified per-session

6. **IPC Channel Seam** (`src/core/ipc-channels.ts`)
   - Current: 10 `metaSession*` channels (lines 17-28)
   - Target: Remove all `metaSession*` channels
   - Required new channels: `session:create-child`, `session:prompt`, `session:destroy`, `session:inspect`

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| CLI has separate meta-session/work-session command groups | `tools/stoa-ctl/index.ts:41-77` | USAGE_TEXT defines two separate command families |
| CLI uses `STOA_META_SESSION_ID` with `activeMetaSessionId` fallback | `tools/stoa-ctl/index.ts:93-113` | `resolveHeaders()` line 94-98 |
| Control server has `/ctl/meta-sessions/*` endpoints | `src/core/meta-session-control-server.ts:467-546` | Lines 467-546 define meta-session CRUD |
| Control server has `/ctl/proposals/*` and `/ctl/dispatch/*` endpoints | `src/core/meta-session-control-server.ts:548-635` | Lines 548-635 |
| Control server `authorize()` checks meta session source | `src/core/meta-session-control-server.ts:83-96` | Lines 88-95 |
| Command env injects `STOA_META_SESSION: '1'` | `src/core/meta-session-command-env.ts:17` | Line 17 |
| Bootstrap prompt says "You are running inside a Stoa meta session" | `src/core/meta-session-bootstrap-prompt.ts:2` | Line 2 |
| Bootstrap prompt references `stoa-ctl meta-sessions` | `src/core/meta-session-bootstrap-prompt.ts:28` | Line 28 |
| Main process has separate meta session lifecycle | `src/main/index.ts:470-472,848-1059` | `MetaSessionManager.create()` and `launchMetaSessionRuntimeWithGuard()` |
| Main process has separate proposal/dispatch system | `src/main/index.ts:564,587-595` | `MetaSessionProposalStore` and `MetaSessionCommandDispatcher` |
| IPC has 10 meta-session channels | `src/core/ipc-channels.ts:17-28` | Lines 17-28 |

### Risks / Unknowns

- [!] `launchMetaSessionRuntimeWithGuard()` at `src/main/index.ts:848-1015` has 168 lines of meta-session-specific logic including `runtimeManager` snapshot, `runtimeHooks`, and `stoaCtlShim` setup. This must be generalized.
- [?] The current `metaSessionManager` uses separate state file (`resolveMetaSessionStateFilePath()`). New design says use project session state file. Need to verify state migration approach.
- [?] `SessionEventBridge.configureServerApp()` at `src/main/index.ts:662-719` wires meta session control server with `metaSessionSource`. This wiring will need complete replacement.
- [!] The `stoa-ctl` CLI currently uses `activeMetaSessionId` from port file as implicit fallback (`tools/stoa-ctl/index.ts:97`). New design forbids this — must fail if no session caller context.