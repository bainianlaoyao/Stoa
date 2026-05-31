---
date: 2026-05-29
topic: stoa-ctl unified session tree - backend auth and caller resolution
status: completed
mode: context-gathering
sources: 9
---

## Context Report: stoa-ctl Unified Session Tree - Backend Auth and Caller Resolution

### Why This Was Gathered

The design doc at `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` mandates breaking changes to backend auth/caller resolution. This report identifies every spot that must change, with file paths and line citations.

### Summary

Current auth is a two-tier gate: either a global `ctlSecret` from the port file (local user), or any valid `sessionId` that exists in `MetaSessionManager`. There is no token validation, no runtime liveness check, and the concept of "active meta session" leaks into both the auth path and the port file. The design requires replacing this with a `SessionCallerAuthRegistry` that mints per-session tokens, enforces visibility boundaries, and removes `activeMetaSessionId` entirely.

### Key Findings

**1. Auth model lives in `authorize()` at `meta-session-control-server.ts:83-96`**

```ts
function authorize(
  metaSessionSource: MetaSessionSource,
  sessionId: string | undefined,
  secret: string | undefined,
  expectedSecret: string | undefined
): boolean {
  if (expectedSecret && secret === expectedSecret) {
    return true  // ← local-user path: any sessionId works, no token
  }
  if (!sessionId) {
    return false
  }
  return metaSessionSource.getSession(sessionId) !== null  // ← session path: only existence check
}
```

Breaking changes needed:
- Replace `secret === expectedSecret` with token validation
- Replace `getSession() !== null` with live token registry lookup
- Add `SessionCallerAuthRegistry` interface and `authorizeHookRequest`-style session secret verification
- Add `forbidden_visibility_scope` and `forbidden_authority_scope` error codes

**2. `activeMetaSessionId` leaks into 5 spots**

| Location | File | Line | Usage |
|----------|------|------|-------|
| Port file schema | `stoa-ctl-port-file.ts` | 9 | `activeMetaSessionId: string \| null` |
| Port file write | `stoa-ctl-port-file.ts` | 56 | Read + pass through |
| Port file generation | `main/index.ts` | 752 | `activeMetaSessionId: snapshot?.activeMetaSessionId ?? null` |
| Auth middleware | `meta-session-control-server.ts` | 164-165 | Header extraction: `x-stoa-session-id` only, no token |
| `whoami` response | `meta-session-control-server.ts` | 186-202 | Returns `sessionId`, `title`, `status`, etc. |

Breaking changes:
- Port file: remove `activeMetaSessionId` entirely from `PortFileData`
- Auth: add `x-stoa-session-token` header support, validate against runtime token registry
- `whoami`: replace with `callerType`, `rootSessionId`, `depth`, `visibility`, `permissions` per the spec's `whoami` contract
- All `/ctl/*` routes currently do not enforce visibility scopes (they serve everything to any valid caller)

**3. Session env injection is meta-session-only at `meta-session-command-env.ts:10-24`**

```ts
export function buildMetaSessionCommandEnv(options: BuildMetaSessionCommandEnvOptions): Record<string, string> {
  return {
    STOA_META_SESSION: '1',           // ← DELETE: meta-session-specific
    STOA_META_SESSION_ID: options.sessionId,  // ← DELETE
    STOA_SESSION_ID: options.sessionId,
    STOA_CTL_BASE_URL: `http://127.0.0.1:${options.webhookPort}`,
    STOA_CTL_COMMAND: 'stoa-ctl',
    PATH: pathParts.join(delimiter)
  }
}
```

Breaking changes:
- Rename to `buildSessionCommandEnv`
- Add `STOA_CTL_SESSION_TOKEN`: minted per session, runtime-only, not persisted
- Delete `STOA_META_SESSION` and `STOA_META_SESSION_ID`
- Extend to ALL session types (shell, opencode, codex, claude-code), not just meta sessions
- Shell session gets command env but NOT bootstrap prompt
- Called from `main/index.ts:1000-1004` only for meta session launch paths; must expand to all `launchSessionRuntimeWithGuard` calls

**4. Caller resolution in `main/index.ts` ties into `MetaSessionManager` (not `ProjectSessionManager`)**

- `main/index.ts:665-716`: `configureServerApp` creates `MetaSessionControlServerOptions` with `metaSessionSource` from `activeMetaSessionManager`
- `main/index.ts:637`: `metaSessionCtlSecret = generateSecret()` - single secret for all auth
- `main/index.ts:976-984`: `hookLease.ensureLease()` called with `stoa-meta-session` project ID for meta sessions, but regular sessions use their own project ID
- The design wants ONE auth registry for ALL sessions, not a separate meta session auth path

Breaking changes:
- Replace `metaSessionSource` adapter with `SessionSupervisor` that operates on unified session graph
- Replace `metaSessionCtlSecret` with per-session tokens via `SessionCallerAuthRegistry`
- Session token minted at runtime start (via `sessionEventBridge.registerSessionSecret` already exists at `main/index.ts:59-61` but not wired to control server auth)
- `launchTrackedSessionRuntime` at `launch-tracked-session-runtime.ts:59-61` registers session secret, but `meta-session-control-server.ts` does not validate it

**5. `MetaSessionCommandDispatcher` at `meta-session-command-dispatcher.ts:96-188`**

- `promptWorkSession`: uses `metaSessionId` only for proposal tracking, not for visibility enforcement
- `sendKeysToWorkSession`: no auth check, just checks session existence
- `dispatchProposal`: proposal-based flow - the design deletes this as the main path

Breaking changes:
- Rename to `SessionCommandDispatcher`
- All dispatch methods must accept caller context and enforce visibility/authority rules
- Add `forbidden_authority_scope` errors per authority contract table in the design
- Remove `proposal` flow as primary dispatch path

**6. Port file at `stoa-ctl-port-file.ts:22-27, 29-59`**

Current schema:
```ts
export interface PortFileData {
  port: number
  pid: number
  activeMetaSessionId: string | null  // ← DELETE
  secret: string
  startedAt: string
}
```

Breaking changes:
- Remove `activeMetaSessionId` from port file
- The `secret` remains for local-user caller auth via `x-stoa-secret`

**7. `MetaSessionManager` at `meta-session-manager.ts`**

- Independent session store with separate persistence file (`~/.stoa/meta-session.json`)
- The design deletes this as the authoritative state source

Breaking changes:
- All meta session state must migrate to `ProjectSessionManager` with `parentSessionId` extension
- The `MetaSessionManager` class itself should be deleted

**8. `MetaSessionBootstrapPrompt` at `meta-session-bootstrap-prompt.ts`**

- References "Stoa meta session", `stoa-ctl meta-sessions`, `whoami`/`capabilities`/`state brief`/`work-sessions list`
- Explicit "HARD RULE: METADATA IS NOT CONTENT" about session context

Breaking changes:
- Replace with `SessionBootstrapPromptService` that describes:
  - Current session identity (from env vars)
  - Tree-local visibility rules
  - Available `stoa-ctl session` commands
  - What session can/cannot control

**9. IPC channels at `ipc-channels.ts`**

- `meta-session:*` channels (lines 17-28) are meta-session-specific
- No `session:prompt`, `session:destroy`, `session:inspect` equivalents

Breaking changes:
- Add: `session:create-child`, `session:prompt`, `session:destroy`, `session:inspect`
- Delete: `meta-session:bootstrap`, `meta-session:create`, `meta-session:set-active`, `meta-session:archive`, `meta-session:restore`, `meta-session:event`, `meta-session:proposal-*`, `meta-session:inspector-set-target`

**10. `SessionSummary` at `project-session.ts:122-145`**

Current shape has no `parentSessionId` or `createdBySessionId`.

Breaking changes:
- Add `parentSessionId: string | null`
- Add `createdBySessionId: string | null`

**11. Bootstrap state at `project-session.ts:265-271`**

```ts
export interface BootstrapState {
  activeProjectId: string | null
  activeSessionId: string | null
  projects: ProjectSummary[]
  sessions: SessionSummary[]  // ← currently flat
  terminalWebhookPort: number | null
}
```

Breaking changes:
- Add `sessions` → `SessionNodeSnapshot[]` (with `tree: SessionTreeMeta` per session)
- `SessionTreeMeta` contains `rootSessionId`, `depth`, `childCount`, `descendantCount`

**12. `SessionEventBridge` registers session secret but control server ignores it**

- `launch-tracked-session-runtime.ts:59-61`: `sessionEventBridge.registerSessionSecret(session.id, hookLease.lease.sessionSecret)`
- `meta-session-control-server.ts:83-96`: `authorize()` never calls `sessionEventBridge` to validate token

Breaking changes:
- Control server must validate `x-stoa-session-token` header against live session registry
- `SessionCallerAuthRegistry` must track live session tokens
- Token invalidation on session stop/archive

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `authorize()` function with two-tier auth | `src/core/meta-session-control-server.ts` | lines 83-96 |
| Middleware extracts `x-stoa-session-id` and `x-stoa-secret` | `src/core/meta-session-control-server.ts` | lines 164-176 |
| `whoami` returns session metadata | `src/core/meta-session-control-server.ts` | lines 186-202 |
| `MetaSessionControlServerOptions` interface | `src/core/meta-session-control-server.ts` | lines 29-39 |
| `metaSessionCtlSecret` generated in main | `src/main/index.ts` | line 637 |
| `configureServerApp` wires `metaSessionSource` | `src/main/index.ts` | lines 662-719 |
| `portFileData` includes `activeMetaSessionId` | `src/core/stoa-ctl-port-file.ts` | line 9 |
| Port file written with `activeMetaSessionId` | `src/main/index.ts` | lines 747-757 |
| `buildMetaSessionCommandEnv` injects meta-session-only env vars | `src/core/meta-session-command-env.ts` | lines 10-24 |
| Env injection only for meta sessions | `src/main/index.ts` | lines 1000-1004 |
| `MetaSessionManager` separate store | `src/core/meta-session-manager.ts` | lines 63-243 |
| `MetaSessionCommandDispatcher` with no visibility enforcement | `src/core/meta-session-command-dispatcher.ts` | lines 93-189 |
| `MetaSessionBootstrapPrompt` with meta-session-specific content | `src/core/meta-session-bootstrap-prompt.ts` | lines 1-32 |
| `SessionSummary` without `parentSessionId`/`createdBySessionId` | `src/shared/project-session.ts` | lines 122-145 |
| `BootstrapState` with flat sessions array | `src/shared/project-session.ts` | lines 265-271 |
| `meta-session:*` IPC channels | `src/core/ipc-channels.ts` | lines 17-28 |
| `registerSessionSecret` called but not validated | `src/main/launch-tracked-session-runtime.ts` | lines 59-61 |

### Risks / Unknowns

- [!] The design says "no token persistence" but the current `hookLease.sessionSecret` is the closest existing primitive. Need to clarify whether `STOA_CTL_SESSION_TOKEN` reuses `sessionSecret` from `hookLease` or is a separate token.
- [!] `SessionVisibilityService` does not exist yet - it must be implemented. The design says "unified calculation of rootSessionId/depth/visible set/authority matrix" must be centralized, not scattered.
- [?] Whether `stoa-ctl` CLI will be vendored/replaced: the shim at `src/core/stoa-ctl-shim.ts` and `stoa-ctl-system-shim` are referenced but not read. The CLI's caller resolution logic (local-user vs session) is not visible in the Stoa codebase.
- [?] The design says `shell` session has command env but no agent bootstrap prompt. Current `shell` sessions do not get any `stoa-ctl` env injection - this is a new capability that requires `launchSessionRuntimeWithGuard` to inject `commandEnv` for all session types.
- [?] `SessionGraphEvent` envelope with `graphVersion` does not exist - requires new event type and renderer store upgrade.

### Breaking Change Summary

| # | Spot | What Changes |
|---|------|-------------|
| 1 | `src/core/meta-session-control-server.ts` | Rename to `session-control-server.ts`, replace `authorize()`, add token validation, add visibility/authority enforcement, rename all routes from `/meta-sessions/*` → `/sessions/*` |
| 2 | `src/core/meta-session-command-env.ts` | Rename to `session-command-env.ts`, add `STOA_CTL_SESSION_TOKEN`, delete `STOA_META_SESSION`/`STOA_META_SESSION_ID`, apply to all session types |
| 3 | `src/core/stoa-ctl-port-file.ts` | Remove `activeMetaSessionId` from `PortFileData` |
| 4 | `src/main/index.ts` | Wire `commandEnv` for all session types, add `SessionCallerAuthRegistry`, remove `metaSessionCtlSecret` per-session token, update port file write |
| 5 | `src/core/meta-session-manager.ts` | Delete - replaced by unified `ProjectSessionManager` |
| 6 | `src/core/meta-session-command-dispatcher.ts` | Rename to `session-command-dispatcher.ts`, add caller context/visibility enforcement |
| 7 | `src/core/meta-session-bootstrap-prompt.ts` | Replace with `SessionBootstrapPromptService` |
| 8 | `src/core/meta-session-context-assembler.ts` | Rename to `session-context-assembler.ts`, add tree-based context |
| 9 | `src/core/meta-session-proposal-store.ts` | Delete - proposal/dispatch is no longer primary path |
| 10 | `src/shared/project-session.ts` | Add `parentSessionId`/`createdBySessionId` to `SessionSummary`, add `SessionTreeMeta` and `SessionNodeSnapshot`, update `BootstrapState` |
| 11 | `src/core/ipc-channels.ts` | Add `session:prompt`/`session:destroy`/`session:inspect`/`session:create-child`, remove `meta-session:*` |
| 12 | `src/shared/project-session.ts` `RendererApi` | Remove meta-session methods, add session management methods |
| 13 | `src/main/launch-tracked-session-runtime.ts` | Pass `commandEnv` for all session types |
| 14 | `src/core/session-event-bridge.ts` | Register session token for all session types |

---

## Context Handoff: stoa-ctl Unified Session Tree - Auth and Caller Resolution

Start here: `research/2026-05-29-stoa-ctl-unified-session-tree-auth-research.md`

This report covers all backend auth and caller resolution details that must change per the design at `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`. All citations include file paths and line numbers. Use this as the authoritative list of breaking change spots.