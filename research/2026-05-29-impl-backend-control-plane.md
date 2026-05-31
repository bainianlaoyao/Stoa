---
date: 2026-05-29
topic: impl backend unified session control plane
status: completed
mode: context-gathering
sources: 23
---

## Context Report: Backend Control Plane / Session Graph Implementation Seams

### Why This Was Gathered

Implementation-focused bounded research for replacing the meta-session control plane with the unified session control plane defined in `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`.

### Summary

The current backend still splits control across two products: flat project sessions and a parallel meta-session stack. The unified session-tree design requires removing the meta-session control surface, moving caller identity from `activeMetaSessionId` guessing to explicit local-user or live-session auth, and collapsing CLI, HTTP, IPC, env injection, and main-process launch wiring onto one session supervisor path. Current uncommitted work in `src/main/index.ts` is an additive sidebar IPC change and does not overlap this seam.

### Key Findings

#### 1. Exact seams to replace the meta-session control plane

1. **CLI seam in `tools/stoa-ctl/index.ts`**
   - Current CLI surface is split across `work-sessions`, `meta-sessions`, `proposals`, and `dispatch`, while the target design requires one `session` command family with `list/create/inspect/prompt/destroy`. `tools/stoa-ctl/index.ts:41-77`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:371-385`
   - Caller resolution is still meta-session-centric: `resolveHeaders()` tries `STOA_META_SESSION_ID`, then `STOA_SESSION_ID`, then `--session`, then `portFileData.activeMetaSessionId`, and throws if none exist. That implicit active-session fallback is explicitly banned by the design. `tools/stoa-ctl/index.ts:93-113`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:400-414`

2. **HTTP control server seam in `src/core/meta-session-control-server.ts`**
   - The server is still a meta-session server by type and route shape: it depends on `MetaSessionSource`, `MetaSessionCommandDispatcher`, and `MetaSessionProposalStore`. `src/core/meta-session-control-server.ts:15-39`
   - It exposes separate route families for legacy state/work-session/meta-session/proposal/dispatch flows instead of the unified session-control surface required by the design. `src/core/meta-session-control-server.ts:231-459`; `src/core/meta-session-control-server.ts:467-635`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:451-464`
   - `/ctl/work-sessions/*` handlers operate on the global flat session set and do not apply caller-filtered tree visibility. `src/core/meta-session-control-server.ts:292-459`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:260-334`

3. **Session command env seam in `src/core/meta-session-command-env.ts`**
   - Env injection is still meta-session-only and emits `STOA_META_SESSION`, `STOA_META_SESSION_ID`, `STOA_SESSION_ID`, and `STOA_CTL_BASE_URL`. It does not emit `STOA_CTL_SESSION_TOKEN`, and it is named/structured around meta sessions. `src/core/meta-session-command-env.ts:3-24`
   - The design requires one `SessionCommandEnv` for all provider-managed sessions, with `STOA_SESSION_ID`, `STOA_CTL_SESSION_TOKEN`, `STOA_CTL_BASE_URL`, and `stoa-ctl` on PATH for every session type. `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:623-633`

4. **Bootstrap prompt seam in `src/core/meta-session-bootstrap-prompt.ts`**
   - The current prompt declares “You are running inside a Stoa meta session” and teaches `stoa-ctl work-sessions ...` plus `stoa-ctl meta-sessions ...`. `src/core/meta-session-bootstrap-prompt.ts:1-31`
   - The target prompt must instead describe current session identity, tree-local visibility, allowed controls, and disallowed scopes. `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:635-644`

5. **Main-process lifecycle seam in `src/main/index.ts`**
   - Main still constructs a separate meta-session subsystem: `MetaSessionManager`, `MetaSessionProposalStore`, `MetaSessionContextAssembler`, `MetaSessionCommandDispatcher`, `createMetaSessionControlServer`, `buildMetaSessionCommandEnv`, `META_SESSION_BOOTSTRAP_PROMPT`. `src/main/index.ts:13-24`; `src/main/index.ts:466-567`
   - Control server wiring is explicitly meta-session-backed through `metaSessionSource`, separate proposal storage, separate dispatcher, and a shared `metaSessionCtlSecret`. `src/main/index.ts:637-719`
   - Port-file refresh persists `activeMetaSessionId`, which the new design removes. `src/main/index.ts:747-757`; `src/core/stoa-ctl-port-file.ts:6-12`
   - Runtime launch is bifurcated: ordinary sessions use `launchSessionRuntimeWithGuard`, while meta sessions use a separate `launchMetaSessionRuntimeWithGuard` path with its own runtime snapshot, bootstrap logic, and command env injection. `src/main/index.ts:787-842`; `src/main/index.ts:848-1015`
   - Only the meta-session path passes `commandEnv`; normal session launch does not. `src/main/index.ts:815-828`; `src/main/index.ts:1000-1005`

6. **IPC seam in `src/core/ipc-channels.ts` and `src/main/index.ts`**
   - IPC still exposes a separate `meta-session:*` channel family. `src/core/ipc-channels.ts:17-28`
   - Main registers dedicated handlers for bootstrap/create/set-active/archive/restore/proposal/dispatch/inspector meta-session flows. `src/main/index.ts:1556-1655`
   - The design explicitly removes `meta-session:*` as a compatibility layer and requires unified session-control channels or equivalents that share one business entry point. `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:49-56`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:734-744`

#### 2. Current auth and caller resolution details that must change

1. **Auth is currently a weak two-path gate**
   - `authorize()` returns true either when the loopback secret matches or when the provided `sessionId` merely exists in `MetaSessionSource`. There is no token validation, no live-runtime check, and no authority/visibility check. `src/core/meta-session-control-server.ts:83-96`
   - `/ctl` middleware only reads `x-stoa-session-id` and `x-stoa-secret`, then returns `invalid_secret` on failure. There is no `x-stoa-session-token`. `src/core/meta-session-control-server.ts:164-176`
   - The design requires a `SessionCallerAuthRegistry` with two caller classes only: local-user via `x-stoa-secret`, and live-session via `x-stoa-session-id` plus `x-stoa-session-token`. `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:566-610`

2. **Caller identity still leaks through `activeMetaSessionId`**
   - Port-file schema persists `activeMetaSessionId`. `src/core/stoa-ctl-port-file.ts:6-12`
   - Port-file parsing preserves it and CLI caller resolution consumes it as an implicit fallback. `src/core/stoa-ctl-port-file.ts:29-59`; `tools/stoa-ctl/index.ts:93-113`
   - The design forbids inferring caller identity from `activeMetaSessionId` or any “active control session” fallback. `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:409-414`

3. **`whoami` and `capabilities` are still meta-session shaped**
   - `whoami` looks up a meta session and returns meta-session metadata such as `capabilityLevel`, `pendingProposalCount`, and `activeTargetCount`. `src/core/meta-session-control-server.ts:186-202`
   - `capabilities` advertises meta-session management and proposal-dispatch features. `src/core/meta-session-control-server.ts:205-228`
   - The design requires `whoami` to return caller type and tree scope, and `capabilities` to report unified authority scope. `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:480-520`

4. **Visibility and authority are not enforced anywhere in the current control server**
   - `/ctl/work-sessions` lists every non-archived session in the project snapshot. `src/core/meta-session-control-server.ts:292-304`
   - Prompt and send-keys routes pass `metaSessionId` into the dispatcher, but server-side filtering is not based on same-depth-plus-descendants visibility or scoped destroy/create rules. `src/core/meta-session-control-server.ts:423-459`
   - The design requires centralized visibility and authority rules: same-depth peers plus descendants are visible; `create` only creates direct children; `destroy` only allows self or descendants; invisible targets must collapse to `unknown_session`. `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:295-334`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:431-478`

5. **The runtime already mints a live session secret, but the control plane ignores it**
   - `launchTrackedSessionRuntime()` obtains a hook lease and registers `lease.sessionSecret` with `sessionEventBridge`. `src/main/launch-tracked-session-runtime.ts:52-61`
   - Regular session launches already pass through this path, but `launchSessionRuntimeWithGuard()` never supplies control-plane env vars, and `meta-session-control-server` never checks the registered secret. `src/main/index.ts:787-842`; `src/main/launch-tracked-session-runtime.ts:71-99`; `src/core/meta-session-control-server.ts:83-96`
   - This is the most direct existing primitive that can be refactored into the new per-session runtime-only auth registry required by the design. `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:578-610`

6. **Shared session model is still flat**
   - `SessionSummary` has no `parentSessionId` or `createdBySessionId`. `src/shared/project-session.ts:122-145`
   - `BootstrapState.sessions` is still `SessionSummary[]`, not a derived tree read model. `src/shared/project-session.ts:265-270`
   - The design requires persistent `parentSessionId` plus read-model `SessionNodeSnapshot`/`SessionTreeMeta`, which means caller visibility cannot be implemented correctly until the model is extended. `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:60-70`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:107-144`

#### 3. Likely conflict with existing uncommitted `src/main/index.ts` changes

- The current uncommitted diff in `src/main/index.ts` is only a new import from `@core/sidebar-state-store` plus two IPC handlers, `sidebarGetState` and `sidebarSetState`. `src/main/index.ts:27`; `src/main/index.ts:1452-1459`; `git diff -- src/main/index.ts`
- Those handlers sit above the meta-session handler block and do not overlap imports, control-server wiring, runtime launch paths, or meta-session IPC registrations that the unified session-tree work must replace. `src/main/index.ts:1450-1459`; `src/main/index.ts:1556-1655`
- Conclusion: no direct conflict is visible right now, but any future work that also edits the large meta-session region of `src/main/index.ts` will still have a high merge surface because the unified-session refactor removes several hundred lines from the same file. `src/main/index.ts:13-24`; `src/main/index.ts:466-719`; `src/main/index.ts:848-1059`

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| CLI still split into work/meta/proposal/dispatch command families | `tools/stoa-ctl/index.ts` | `41-77` |
| CLI caller fallback uses `activeMetaSessionId` | `tools/stoa-ctl/index.ts` | `93-113` |
| Port file persists `activeMetaSessionId` | `src/core/stoa-ctl-port-file.ts` | `6-12`, `29-59` |
| Auth accepts either shared secret or existing meta-session id | `src/core/meta-session-control-server.ts` | `83-96` |
| `/ctl` middleware lacks session token header validation | `src/core/meta-session-control-server.ts` | `164-176` |
| `whoami` and `capabilities` remain meta-session-specific | `src/core/meta-session-control-server.ts` | `186-228` |
| `/ctl/work-sessions/*` routes expose flat global work-session access | `src/core/meta-session-control-server.ts` | `292-459` |
| `/ctl/meta-sessions/*`, `/ctl/proposals/*`, `/ctl/dispatch/*` remain separate stacks | `src/core/meta-session-control-server.ts` | `467-635` |
| Env injection still emits meta-session vars only | `src/core/meta-session-command-env.ts` | `3-24` |
| Bootstrap prompt still teaches meta-session behavior | `src/core/meta-session-bootstrap-prompt.ts` | `1-31` |
| Main imports and initializes a parallel meta-session subsystem | `src/main/index.ts` | `13-24`, `466-567` |
| Control server wiring depends on `metaSessionSource` and `metaSessionCtlSecret` | `src/main/index.ts` | `637-719` |
| Port refresh writes `activeMetaSessionId` | `src/main/index.ts` | `747-757` |
| Regular session launch path has no command env injection | `src/main/index.ts` | `787-842` |
| Meta-session launch path has separate runtime + env + bootstrap logic | `src/main/index.ts` | `848-1015` |
| Meta-session IPC handlers occupy a dedicated block | `src/main/index.ts` | `1556-1655` |
| Runtime already registers live session secret | `src/main/launch-tracked-session-runtime.ts` | `52-61` |
| Shared session model is still flat | `src/shared/project-session.ts` | `122-145`, `265-270` |
| Unified design removes product-level meta session and compatibility IPC | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `35-56` |
| Unified design requires `session` CLI family | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `371-454` |
| Unified design forbids `activeMetaSessionId` fallback | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `400-414` |
| Unified design defines visibility and authority scopes | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `260-334` |
| Unified design requires token-based session caller auth and shared env injection | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `566-633` |

### Risks / Unknowns

- [!] The largest implementation seam is `src/main/index.ts`, where meta-session state, HTTP wiring, bootstrap behavior, and runtime launch are interleaved in one file. Replacing this cleanly likely needs extracting a `SessionSupervisor` first rather than incrementally patching the existing branches.
- [!] The current `hookLease.lease.sessionSecret` is the nearest existing runtime-only token primitive, but the design names a new `STOA_CTL_SESSION_TOKEN`. Reuse vs new token source is still an implementation decision.
- [!] The current shared model has no tree fields, so visibility/authority enforcement cannot be bolted onto the current server without first extending `SessionSummary` and the read model.
- [?] The design says no migration tooling. Existing `~/.stoa/meta-session.json` consumers must therefore be deleted or ignored outright, and any still-live renderer/meta-session code depending on that state will break immediately until the unified path lands end-to-end.

## Context Handoff: Backend Control Plane / Session Graph Implementation Seams

Start here: `research/2026-05-29-impl-backend-control-plane.md`

Context only. Use the saved report as the source of truth.
