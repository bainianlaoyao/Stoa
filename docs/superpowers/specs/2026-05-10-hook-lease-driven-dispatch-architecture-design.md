# Hook Lease-Driven Dispatch Architecture Design

Date: 2026-05-10
Status: Drafted for user review

## Goal

Define the final hook architecture for STOA so Claude Code, Codex, and OpenCode hooks remain robust across:

- STOA restart
- random webhook port rebinding
- manual terminal launches inside managed workspaces
- multiple STOA instances opening the same workspace

This design is intentionally final-form. It does not describe a phased rollout. It defines the target architecture that should replace the current stale-port sidecar model with breaking changes allowed.

## Problem Summary

The current architecture stores runtime truth in workspace-scoped hook artifacts.

That is the root mistake.

Current sidecars and hook files capture facts that are inherently runtime-scoped:

- webhook port
- webhook base URL
- session secret expectations
- effective owner instance

Those facts are unstable across restart and inherently session-scoped. Once they are baked into workspace files, the system becomes fragile by construction.

The failure patterns already observed are direct consequences:

1. Claude Code hook URLs become stale after STOA restart.
2. Codex silently stops reporting if runtime env injection is absent.
3. Manual CLI launches inside a managed workspace produce hook noise or false failures.
4. Multiple STOA instances targeting the same workspace can overwrite each other's routing assumptions.

## Decisions Already Made

- This is prototype-phase work. Breaking changes are acceptable.
- No compatibility migration layer should be added.
- The design must be safe when multiple STOA instances open the same workspace.
- Multi-instance safety means `no corruption, no cross-wire, no accidental ownership takeover`, not shared collaborative control of the same session.
- Workspace hook artifacts must remain stable.
- Runtime routing must become late-bound.

## Source Context

- [research/2026-05-09-hook-sidecar-port-staleness-multi-stoa.md](/D:/Data/DEV/ultra_simple_panel/research/2026-05-09-hook-sidecar-port-staleness-multi-stoa.md)
- [src/core/webhook-server.ts](/D:/Data/DEV/ultra_simple_panel/src/core/webhook-server.ts)
- [src/extensions/providers/claude-hook-sidecar.ts](/D:/Data/DEV/ultra_simple_panel/src/extensions/providers/claude-hook-sidecar.ts)
- [src/extensions/providers/codex-provider.ts](/D:/Data/DEV/ultra_simple_panel/src/extensions/providers/codex-provider.ts)
- [src/main/managed-sidecar-maintenance.ts](/D:/Data/DEV/ultra_simple_panel/src/main/managed-sidecar-maintenance.ts)
- [src/main/session-event-bridge.ts](/D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts)
- Claude Code hooks documentation: https://code.claude.com/docs/en/hooks

The Claude documentation matters here because, as of May 10, 2026, `SessionStart` and `Setup` support `command` and `mcp_tool` hooks, not a durable runtime-safe HTTP URL strategy. STOA should converge to command hooks for Claude rather than continue investing in hardcoded local HTTP sidecars.

## Architecture Summary

The final architecture is `lease-driven command dispatch`.

The core split is:

- `workspace-scoped artifacts` are static
- `session-scoped runtime truth` lives in session leases
- `hook routing` is resolved at dispatch time, not install time

The system has six logical units:

1. `Workspace Hook Surface`
   Stable provider hook configuration files under the workspace.
2. `Unified Hook Dispatcher`
   A stable command entrypoint invoked by all provider hook surfaces.
3. `Session Hook Lease Registry`
   The runtime source of truth for routing and authentication.
4. `Instance Identity Service`
   Defines which STOA process currently owns a session lease.
5. `Webhook Receiver`
   Accepts and validates hook posts and forwards canonical events into STOA.
6. `Lease Maintainer`
   Refreshes, expires, reclaims, and releases leases.

## Core Invariants

These are non-negotiable rules of the design.

### 1. No runtime truth in workspace files

No workspace hook artifact may contain:

- webhook port
- webhook base URL
- session secret
- instance owner identity
- lease freshness state

### 2. Runtime truth is session-scoped

Routing and auth truth belong to a session lease, not a project, workspace, or provider installation pass.

### 3. Dispatch is late-bound

The destination STOA instance is resolved when a hook fires, not when sidecars are written.

### 4. One fresh owner per session

At any moment, one session can have at most one fresh lease owner.

### 5. Workspace concurrency must be non-corrupting

Two STOA instances may open the same workspace at the same time. They must not break each other's live sessions by rewriting routing state in shared workspace files.

### 6. Manual terminal launches must be silent-safe

If a user runs Claude Code, Codex, or OpenCode manually in a managed workspace without STOA session context, hooks must safely no-op. They must not flood the terminal with avoidable errors.

### 7. Secret rotation is mandatory on reclaim

When a new owner reclaims a session lease, the session secret must rotate. Old secrets must stop authorizing future hook posts.

## Final Topology

### Workspace Hook Surface

Each workspace contains only stable hook entrypoints:

- `.claude/settings.json`
- `.codex/hooks.json`
- `.opencode/plugins/stoa-status.ts`
- `.stoa/hook-dispatch.mjs`

These files express:

- which provider events should trigger
- which stable command to invoke

These files do not express:

- where STOA is currently listening
- which STOA process currently owns the session
- whether the current lease is fresh

### Unified Hook Dispatcher

All providers converge on one stable runtime bridge:

```text
node .stoa/hook-dispatch.mjs <provider> <hook-event-name>
```

The dispatcher:

1. reads stdin
2. loads the session lease
3. validates lease freshness
4. derives the provider-specific webhook path
5. posts the hook payload to the active STOA owner
6. exits

The dispatcher is intentionally stateless. It never caches routing state between invocations.

### Session Hook Lease Registry

The registry is the source of truth for:

- current webhook base URL
- current session secret
- current owner instance
- current generation
- freshness window

Workspace files never compete with the registry. They only invoke the dispatcher that reads the registry.

### Instance Identity Service

Each STOA process gets one `instanceId` for its lifetime.

The `instanceId` is attached to every live session lease it owns. This gives the system a concrete notion of ownership without inventing workspace-wide control semantics.

### Webhook Receiver

The receiver remains local to STOA and still accepts provider hook events through:

- `/hooks/claude-code`
- `/hooks/codex`
- `/hooks/opencode`

What changes is how requests arrive there. The receiver is no longer discoverable through stale workspace configuration. It is discovered through the current session lease at dispatch time.

### Lease Maintainer

The maintainer is responsible for:

- lease acquisition
- heartbeat refresh
- expiry
- reclaim
- release

This separates liveness management from sidecar installation.

## Lease Storage Design

### Location

Leases are stored under STOA user data, not the workspace:

```text
<userData>/runtime/hook-leases/<session-id>.json
```

This choice is essential.

Workspace files are shared across instances. Leases are runtime state. They must live in a runtime-owned area.

### Data Model

```ts
interface SessionHookLease {
  version: 1
  sessionId: string
  projectId: string
  provider: 'claude-code' | 'codex' | 'opencode'
  ownerInstanceId: string
  generation: number
  webhookBaseUrl: string
  sessionSecret: string
  createdAt: string
  updatedAt: string
  heartbeatAt: string
  expiresAt: string
}
```

### Intent of Each Field

- `version`
  Protects the on-disk contract.
- `sessionId`
  Primary lookup identity.
- `projectId`
  Included for request header construction and diagnostics.
- `provider`
  Guards path selection and accidental cross-provider misuse.
- `ownerInstanceId`
  Defines current ownership.
- `generation`
  Monotonically increases whenever ownership is freshly reclaimed.
- `webhookBaseUrl`
  Points at the current STOA webhook server for this owner.
- `sessionSecret`
  Current auth token accepted by the receiver for this session.
- `createdAt`, `updatedAt`, `heartbeatAt`, `expiresAt`
  Make freshness explicit and observable.

### Atomicity Requirement

Lease writes must be atomic.

The registry must write a temporary file and then rename it into place so the dispatcher never reads partially-written JSON.

### Expiry Window

The lease window must be short enough that recovery after crash is quick, but long enough to tolerate normal app jitter.

Suggested prototype defaults:

- heartbeat refresh cadence: `5s`
- expiry window: `20s`

The exact constants can evolve, but the architecture requires:

- refresh interval < expiry window
- reclaim only after expiry or explicit release

## Ownership Model

Ownership is session-scoped, not workspace-scoped.

### Rules

1. A fresh lease blocks other instances from claiming the same session.
2. A missing lease may be acquired.
3. An expired lease may be reclaimed.
4. Reclaim rotates the session secret and increments generation.
5. Shared workspace sidecars never imply shared session ownership.

### Consequence

This design explicitly supports:

- two STOA instances opening the same workspace
- each instance owning different sessions in that workspace

This design explicitly does not support:

- two STOA instances jointly controlling one live session
- optimistic multi-writer session ownership

That is the intended safety boundary.

## Hook Dispatch Contract

### CLI Contract

The stable dispatcher entrypoint is:

```text
node .stoa/hook-dispatch.mjs <provider> <hook-event-name>
```

### Input Contract

The dispatcher reads:

- stdin for provider hook payload
- `STOA_HOOK_LEASE_PATH` for the lease location

The dispatcher may also read:

- `STOA_HOOK_DEBUG=1` to enable diagnostics

The dispatcher does not require:

- `STOA_WEBHOOK_PORT`
- `STOA_SESSION_SECRET`
- `STOA_PROJECT_ID`
- `STOA_SESSION_ID`

Those values now come from the lease, not from launch-time hook env.

### Runtime Behavior

For every invocation, the dispatcher must:

1. parse stdin as JSON, defaulting to `{}` if parsing fails
2. read the lease from `STOA_HOOK_LEASE_PATH`
3. validate that the lease exists and is unexpired
4. derive target URL from `lease.webhookBaseUrl` and `<provider>`
5. supplement `hook_event_name` if the provider body does not already provide one
6. post the request with:
   - `x-stoa-session-id`
   - `x-stoa-project-id`
   - `x-stoa-secret`
7. exit

### Provider Path Mapping

- `claude-code` -> `/hooks/claude-code`
- `codex` -> `/hooks/codex`
- `opencode` -> `/hooks/opencode`

## Sidecar Surface by Provider

### Claude Code

Claude sidecars must stop using HTTP hooks.

`.claude/settings.json` becomes command-hook only.

The file may contain entries such as:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Stop`
- `PermissionRequest`

Each entry invokes the shared dispatcher, not a hardcoded local URL.

### Codex

`.codex/hooks.json` remains command-hook based, but provider-specific `hook-stoa.mjs` is removed.

Codex hooks also invoke the shared dispatcher directly.

### OpenCode

OpenCode continues using its plugin surface, but the plugin no longer owns routing.

The plugin must route through the same lease-aware dispatcher contract. It may shell out to `.stoa/hook-dispatch.mjs` or share the same dispatch runtime internally. The architectural requirement is identical late-bound routing, not a provider-private fetch path.

### Shared Workspace Artifact

`.stoa/hook-dispatch.mjs` is the only workspace runtime bridge.

It is stable and long-lived. It is not rewritten during ordinary webhook port changes.

## Session Lifecycle

### Acquire

Before STOA spawns a provider runtime, it acquires a fresh lease for the session and writes:

- current owner instance
- current webhook base URL
- current session secret
- current expiry window

### Spawn

STOA launches the provider with a stable lease pointer:

- `STOA_HOOK_LEASE_PATH`

Provider hook routing now depends on that pointer alone.

### Dispatch

When a provider hook fires, the dispatcher reads the lease and targets the current STOA owner.

### Heartbeat

While STOA owns the session, it refreshes `heartbeatAt` and `expiresAt`.

### Reclaim

If STOA restarts and the previous lease has expired, the new instance reclaims the same lease path with:

- new `ownerInstanceId`
- new `webhookBaseUrl`
- new `sessionSecret`
- incremented `generation`

Running agents do not need sidecar rewrites for this to work because future hook invocations read the new lease.

### Release

When a session exits, is archived, is deleted, or the app shuts down cleanly, STOA releases the lease by deleting it or forcing immediate expiry.

## Webhook Authentication Model

The current in-memory-only secret issuance model is insufficient for lease-driven routing.

The webhook receiver must validate the incoming session secret against the active lease state for that session, not only an ephemeral in-memory map.

This can be implemented as:

- a registry-backed authorizer
- or an in-memory cache whose source of truth is the lease registry

The architectural rule is:

`the active session secret accepted by the webhook receiver must match the active session lease`

That keeps secret rotation and reclaim semantics coherent.

## Main Process Responsibilities

### HookLeaseRegistry

Responsible for:

- acquiring leases
- reading leases
- atomic writes
- refreshing heartbeat
- checking expiry
- reclaiming ownership
- releasing leases

### InstanceIdentityService

Responsible for:

- generating one `instanceId` per STOA process
- exposing it to lease acquisition and reclaim logic

### HookSidecarInstaller

Responsible for writing stable workspace artifacts only:

- `.claude/settings.json`
- `.codex/hooks.json`
- `.opencode/plugins/stoa-status.ts`
- `.stoa/hook-dispatch.mjs`

It is no longer responsible for carrying current webhook port state into sidecars.

### Webhook Receiver

Responsible for:

- request validation
- session secret authorization
- provider hook adaptation
- canonical event ingestion

It is not responsible for teaching sidecars where to find it.

## Managed Sidecar Maintenance Semantics

`syncManagedSidecars()` still has value, but its role changes fundamentally.

It may continue to:

- detect missing managed artifacts
- reinstall stable provider hook files
- clean legacy sidecar artifacts

It must stop meaning:

- rewrite sidecars with current webhook port
- repair runtime hook routing by mutating workspace files

After this architecture lands, runtime port changes are absorbed by lease updates, not by sidecar rewrites.

## Failure Semantics

The dispatcher must default to `silent-safe`.

### Safe No-Op Cases

The dispatcher exits `0` without user-facing error when:

- `STOA_HOOK_LEASE_PATH` is missing
- the lease file does not exist
- the lease file is invalid
- the lease is expired
- the webhook target is unreachable
- the webhook responds with unauthorized

### Debug Path

When `STOA_HOOK_DEBUG=1` is set, the dispatcher may emit diagnostics to:

- `stderr`
- or a dedicated local debug log

Debuggability must be available, but normal user experience must stay quiet.

### Why This Is Correct

Manual CLI launches in a STOA-managed workspace are not STOA-owned sessions.

The correct behavior is a clean no-op, not noisy failure.

## Removed Architecture

The following patterns are explicitly removed by this design:

- Claude HTTP sidecar URLs written with a concrete localhost port
- workspace hook files that embed webhook routing state
- provider-specific direct-fetch scripts that bypass lease lookup
- runtime recovery strategies that depend on agents reloading workspace hook files after STOA restart

## Non-Goals

This design intentionally does not include:

- multi-writer control of one live session
- guaranteed offline event replay while STOA is fully down
- durable hook spooling or dead-letter journals
- compatibility shims for the current stale-port architecture
- workspace-scoped ownership or control-plane locking

These can be designed later if needed, but they are not part of the final elegant routing model.

## Repository Shape After Implementation

The exact filenames can move, but the architecture implies artifacts in this shape:

- main-process lease registry module
- main-process instance identity module
- shared dispatcher artifact generator
- provider sidecar writers that emit stable command hooks
- receiver authorization logic aligned with active leases

Likely touched areas include:

- `src/main/`
- `src/core/`
- `src/extensions/providers/`

The vendored upstream boundary under `research/upstreams/evolver` remains read-only.

## Acceptance Criteria

1. Claude hooks no longer use `type: "http"` or hardcoded localhost URLs in `.claude/settings.json`.
2. Workspace sidecar files contain no current webhook port or session secret.
3. Claude Code, Codex, and OpenCode all dispatch through the same lease-aware routing contract.
4. STOA restart with a new webhook port does not require running agents to reload workspace hook files before future hook delivery can succeed.
5. Manual CLI launches inside a managed workspace produce safe no-op hook behavior instead of mass visible errors.
6. Two STOA instances may coexist on the same workspace without one sidecar refresh breaking the other's live session routing.
7. A fresh lease blocks hostile or accidental reclaim of the same session by another STOA instance.
8. Reclaim rotates the session secret and invalidates the previous one.
9. Managed sidecar maintenance remains able to reinstall missing artifacts, but no longer carries runtime port refresh semantics.
10. The repository quality gate still passes after implementation:
    - `npm run test:generate`
    - `npm run typecheck`
    - `npx vitest run`
    - `npm run test:e2e`
    - `npm run test:behavior-coverage`

## Review Questions

The design is intentionally opinionated. The review should focus on these questions:

1. Does the session-scoped lease boundary match the product boundary STOA actually wants?
2. Is `silent-safe` the right default for unmanaged manual CLI launches?
3. Is short-lived session ownership with reclaim after expiry acceptable for restart recovery?
4. Is there any requirement for guaranteed event replay while STOA is down that would force a broader transport design?

If the answers remain aligned with the current product intent, this architecture is the correct final direction.
