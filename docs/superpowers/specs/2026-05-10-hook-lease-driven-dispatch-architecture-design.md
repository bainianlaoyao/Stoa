# Hook Lease-Driven Dispatch Architecture Design

Date: 2026-05-10
Status: Revised after architecture review

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
- Multi-instance safety is guaranteed only for STOA instances that share the same machine-user-scoped STOA runtime root, the same managed hook artifact contract version, and the same runtime lease protocol version.
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

The command surface has two stable artifacts:

- `dispatcher runtime`
  `.stoa/hook-dispatch.mjs`
- `dispatcher launchers`
  platform launchers that invoke the runtime without requiring sidecars to hardcode raw `node ...`

The shared workspace artifact family is versioned as one contract.

All managed providers and installers participating in the same workspace must emit the same hook artifact contract version. Different contract versions are not supported to co-manage one workspace at the same time.

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

### 8. Session identity must be globally unique within one runtime root

`sessionId` must be globally unique across all STOA-managed sessions that can ever coexist under the same `<stoa-runtime-root>`.

This is a hard invariant, not an implementation preference.

### 9. Lease pointers are confined, not free-form

Managed dispatch may load a lease only from the canonical lease directory under the shared runtime root.

An arbitrary filesystem path is never valid routing authority.

### 10. Lease routing is local-only

`webhookBaseUrl` must resolve only to the local STOA receiver for the same OS user context.

Remote hosts, non-loopback interfaces, and non-STOA transports are out of contract.

### 11. Workspace and runtime-root contracts version together

Multi-instance co-management is supported only when both of these match across cooperating STOA builds:

- workspace hook artifact `contractVersion`
- runtime lease protocol `version`

## Trust Boundary

This architecture is designed to stop accidental corruption, stale routing, and unintended cross-instance ownership takeover among cooperating STOA processes for the same OS user.

It is not a sandbox against malicious same-user local code that can already:

- read or modify files under `<stoa-runtime-root>`
- forge environment variables before launching provider processes
- bind its own loopback listeners under the same user context

Within that trust boundary, the contract still requires deterministic rejection of malformed lease pointers, contract mismatches, and lease-marker inconsistencies.

## Final Topology

### Workspace Hook Surface

Each workspace contains only stable hook entrypoints:

- `.claude/settings.json`
- `.codex/hooks.json`
- `.opencode/plugins/stoa-status.ts`
- `.stoa/hook-dispatch.mjs`
- `.stoa/hook-dispatch.cmd`
- `.stoa/hook-dispatch`
- `.stoa/hook-contract.json`

These files express:

- which provider events should trigger
- which stable command to invoke
- which hook artifact contract version is installed

These files do not express:

- where STOA is currently listening
- which STOA process currently owns the session
- whether the current lease is fresh

### Unified Hook Dispatcher

All providers converge on one stable runtime bridge:

```text
.stoa/hook-dispatch <provider> <hook-event-name>
```

The dispatcher:

1. reads stdin
2. loads the session lease
3. validates lease freshness
4. derives the provider-specific webhook path
5. posts the hook payload to the active STOA owner
6. exits

The dispatcher is intentionally stateless. It never caches routing state between invocations.

### Dispatcher Launcher Contract

Provider hook files must not hardcode raw `node .stoa/hook-dispatch.mjs ...`.

They invoke a stable workspace launcher instead:

- Windows providers call `.stoa/hook-dispatch.cmd`
- POSIX providers call `.stoa/hook-dispatch`

Those launchers are stable managed artifacts. Their only job is to locate a usable Node runtime at invocation time and execute `.stoa/hook-dispatch.mjs`.

This matters because launcher resolution is a platform contract, not an implementation detail. The dispatcher runtime is shared. The launcher surface absorbs shell and platform differences.

Provider writers must treat workspace root as the execution anchor.

The sidecar contract is:

- provider hook commands are emitted as workspace-relative invocations
- those invocations must be valid when the hook process runs with `cwd = workspace root`
- if a provider cannot guarantee `cwd = workspace root`, its sidecar writer must emit an absolute path to the workspace launcher instead

There must be no provider-specific ambiguity here. Every managed provider hook surface must resolve the same launcher artifact deterministically.

### Hook Artifact Contract Version

Workspace-managed hook artifacts are one versioned contract.

The installer must write a shared manifest:

```text
.stoa/hook-contract.json
```

with at least:

- `contractVersion`
- `artifactWriter`
- `writtenAt`

Rules:

1. every stable workspace artifact written by STOA belongs to the same `contractVersion`
2. a STOA build may manage a workspace only if it understands and emits that same `contractVersion`
3. if an instance encounters a different installed contract version, it must refuse managed sidecar mutation rather than partially overwrite the workspace with a different contract
4. if an instance encounters a different installed contract version, it must also refuse managed Claude, Codex, and OpenCode session startup in that workspace
5. contract-version mismatch is a hard stop, not a launch-time warning

This intentionally narrows the multi-build support boundary and prevents cross-build workspace corruption.

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

Leases are stored under a machine-user-scoped STOA runtime root shared by all local STOA builds and profiles for the same OS user, not under the workspace and not under profile-specific Electron `userData`:

```text
<stoa-runtime-root>/hook-leases/<session-id>.json
```

This choice is essential.

Workspace files are shared across instances. Leases are runtime state. They must live in a runtime-owned area.

`<stoa-runtime-root>` is a normative path contract.

Required derivation rule:

- Windows:
  `%LOCALAPPDATA%/Stoa/runtime`
- macOS:
  `$HOME/Library/Application Support/Stoa/runtime`
- Linux:
  `$XDG_STATE_HOME/stoa/runtime` when `XDG_STATE_HOME` is set, otherwise `$HOME/.local/state/stoa/runtime`

It must not be derived from:

- Electron profile-specific `userData`
- application version
- build channel
- workspace path
- process-local randomness

Required invariant:

- any STOA build or profile running as the same OS user on the same machine resolves exactly the same `<stoa-runtime-root>`

The safety boundary is explicit:

- supported: multiple STOA instances for the same OS user and machine, sharing one STOA runtime root
- supported only when those instances also share the same managed hook artifact contract version
- supported only when those instances also share the same runtime lease protocol version and mutation-lock semantics
- not in scope: independent STOA profiles that do not share the same runtime root
- not in scope: concurrent co-management by different STOA builds that emit different hook artifact contracts
- not in scope: concurrent co-management by different STOA builds that disagree on lease-file schema, lock-file schema, or failure-journal schema

### Data Model

```ts
interface SessionHookLease {
  version: 1
  sessionId: string
  projectId: string
  provider: 'claude-code' | 'codex' | 'opencode'
  leaseState: 'active' | 'released'
  ownerInstanceId: string
  generation: number
  webhookBaseUrl: string
  sessionSecret: string
  commitLockNonce: string
  commitToken: string
  createdAt: string
  updatedAt: string
  heartbeatAt: string
  expiresAt: string
  releasedAt?: string
}
```

`version` here is the runtime lease protocol version, not the workspace hook artifact contract version.

Both version domains must match across cooperating instances, and mismatch in either domain is a hard stop for managed session startup and managed sidecar mutation.

### Intent of Each Field

- `version`
  Protects the runtime-root lease protocol contract.
- `sessionId`
  Primary lookup identity and runtime-root-global uniqueness key.
- `projectId`
  Included for request header construction and diagnostics.
- `provider`
  Guards path selection and accidental cross-provider misuse.
- `leaseState`
  Distinguishes a live lease from a clean release tombstone.
- `ownerInstanceId`
  Defines current ownership.
- `generation`
  Monotonically increases whenever ownership is freshly reclaimed.
- `webhookBaseUrl`
  Points at the current local STOA webhook server for this owner.
- `sessionSecret`
  Current auth token accepted by the receiver for this session.
- `commitLockNonce`
  Identifies the lock epoch that committed the current lease image.
- `commitToken`
  Identifies the specific commit attempt that produced the current lease image.
- `createdAt`, `updatedAt`, `heartbeatAt`, `expiresAt`
  Make freshness explicit and observable.
- `releasedAt`
  Records the clean-release timestamp when `leaseState = 'released'`.

### Session Identity Rule

`sessionId` must be generated from a domain that is collision-resistant across the entire shared `<stoa-runtime-root>`, not merely within one workspace or one project store.

The architecture requires:

- no two active or tombstoned lease paths under one runtime root may intentionally share the same `sessionId`
- receiver authorization, lease lookup, mutation locking, and failure journaling all assume this invariant
- if STOA cannot prove a new session identifier is globally unique within its generation domain, session startup must fail rather than guess

### Local Routing Rule

`webhookBaseUrl` is a normative local-routing field.

The architecture requires:

- scheme must be `http` or `https`
- host must be loopback-only for the local machine context
- path base must point at the STOA-owned webhook receiver
- no implementation may treat an arbitrary remote URL as valid lease authority

The purpose of this rule is to prevent lease state from becoming an exfiltration vector for hook payloads or session secrets.

### Atomicity Requirement

Lease writes must be atomic.

The registry must write a temporary file and then rename it into place so the dispatcher never reads partially-written JSON.

Atomic rename alone is not sufficient for ownership correctness.

### Lease Mutation Protocol

Every mutating lease operation must first acquire an exclusive per-session mutation lock:

```text
<stoa-runtime-root>/hook-leases/<session-id>.lock/
```

The lock is acquired with atomic directory creation.

The lock directory contains lock metadata:

- `ownerInstanceId`
- `lockNonce`
- `commitToken`
- `createdAt`
- `expiresAt`

The lock directory is also the only valid home for that lock epoch's in-progress candidate lease file.

Required path rule:

- candidate lease writes for `<session-id>` must be staged inside `<session-id>.lock/`
- no implementation may stage candidate lease files as free-floating siblings next to the active lease path

The mutator that acquires the lock becomes the lock owner for exactly one `lockNonce`.

`commitToken` is a second nonce generated only by the current lock owner for the pending commit attempt.

It exists to close the race between "verified lock ownership" and "lease rename committed".

The protocol is:

1. acquire the mutation lock with atomic `mkdir`
2. if the lock already exists, read its metadata
3. if the lock directory exists but metadata is missing, unreadable, or schema-invalid, treat the lock as `metadata-corrupt`
4. a `metadata-corrupt` lock may be removed only when the lock directory mtime is older than the lock-expiry window
5. if valid lock metadata exists and the existing lock is still fresh, acquisition fails
6. if valid lock metadata exists and the existing lock is stale, re-read the same metadata immediately before deletion and remove it only if `ownerInstanceId + lockNonce + expiresAt` still match the earlier stale image
7. after stale or corrupt lock cleanup, retry acquisition
8. after lock acquisition, write fresh lock metadata before any lease mutation work begins
9. after lock acquisition, reread the lease from disk
10. re-evaluate the operation precondition against the latest lease state
11. refresh the lock metadata if the operation approaches lock expiry
12. generate a fresh `commitToken` and persist it into the lock metadata
13. write the candidate lease inside the lock directory and embed the same `lockNonce` and `commitToken` in commit metadata
14. immediately before rename, reread the lock metadata and verify `ownerInstanceId + lockNonce + commitToken` still match the current lock directory contents
15. atomically rename the candidate lease into place
16. post-rename, reread the lock metadata and abort the operation as invalid if `ownerInstanceId + lockNonce + commitToken` no longer match
17. release the mutation lock

This pre-rename and post-rename verification pair is mandatory.

The first read before lock acquisition is advisory only. The post-lock reread is the state that decides whether acquire, heartbeat, reclaim, or release may proceed.

Commit critical-section rule:

- while a fresh lock exists, no non-owner process may delete, replace, or rename either the active lease file or any candidate lease file for that same `sessionId`
- stale-lock recovery is allowed only after the lock itself has expired
- stale-lock recovery must treat the owner's in-progress candidate file as part of the same protected critical section
- therefore, a successful pre-rename ownership check plus a still-fresh lock is the authority that protects the rename step

Lock safety rules:

- any mutator whose lock ownership check fails before commit must abort without writing
- any mutator whose lock ownership check fails after rename must treat the write as invalid and must not report success to higher layers
- a mutator may treat another lock as stale only when `expiresAt < now`
- long-running mutators must renew `expiresAt` before it lapses
- no lease write is valid unless the committing mutator still owns the same `lockNonce` and `commitToken` across the commit window
- stale-lock recovery must treat `lock.json` plus every file inside the lock directory as one cleanup unit
- stale-lock recovery must never delete a lock directory based only on an earlier stale read; the pre-delete metadata re-read is mandatory
- `metadata-corrupt` lock cleanup may rely on directory mtime only because no trustworthy lock identity remains to compare

### Lease Commit Metadata

Every written lease file must also carry commit provenance:

```ts
interface SessionHookLease {
  version: 1
  sessionId: string
  projectId: string
  provider: 'claude-code' | 'codex' | 'opencode'
  leaseState: 'active' | 'released'
  ownerInstanceId: string
  generation: number
  webhookBaseUrl: string
  sessionSecret: string
  commitLockNonce: string
  commitToken: string
  createdAt: string
  updatedAt: string
  heartbeatAt: string
  expiresAt: string
  releasedAt?: string
}
```

`commitLockNonce` and `commitToken` exist only to prove that the written lease came from the lock epoch that still owned the session during commit.

Reader validation rule:

- any reader that loads a lease while the corresponding mutation lock directory still exists must compare the lease file's `commitLockNonce` and `commitToken` against the lock metadata
- if the lock is fresh and the lease provenance does not match the current lock metadata, the lease image is provisional and must not be treated as authoritative
- a provisional lease image must be treated as `lease invalid for managed-session failure classification`
- a writer that detects post-rename loss of commit ownership must immediately mark the lease image provisional by leaving mismatched provenance behind and must record a managed failure journal entry
- reclaim or stale-lock cleanup is responsible for removing abandoned provisional state once the lock expires

This is what makes a post-rename-invalid lease unservable instead of merely "known bad" to the losing writer.

### Lease Mutation Rules

- `acquire` may succeed only when the lease is missing
- `heartbeat` may succeed only when `ownerInstanceId` and `generation` still match the caller
- `reclaim` may succeed only when the lease is expired or `leaseState = 'released'`, after the post-lock reread confirms that state
- `release` may succeed only for the current owner generation
- `release` never deletes the lease file directly
- the next owner of any existing lease path always enters through `reclaim`, never `acquire`

This protocol is what makes `one fresh owner per session` enforceable instead of aspirational.

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
5. All lease mutations are serialized by the per-session mutation lock.
6. Shared workspace sidecars never imply shared session ownership.
7. A clean release writes a canonical release tombstone instead of deleting the lease.

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
.stoa/hook-dispatch <provider> <hook-event-name>
```

### Input Contract

The dispatcher reads:

- stdin for provider hook payload
- `STOA_HOOK_LEASE_PATH` for the lease location

For managed STOA-owned sessions, the dispatcher also reads the managed-session marker contract:

- `STOA_HOOK_MANAGED=1`
- `STOA_HOOK_SESSION_ID`
- `STOA_HOOK_PROJECT_ID`
- `STOA_HOOK_PROVIDER`
- `STOA_HOOK_SPAWN_OWNER_INSTANCE_ID`
- `STOA_HOOK_SPAWN_GENERATION`

The dispatcher may also read:

- `STOA_HOOK_DEBUG=1` to enable diagnostics

The dispatcher does not require:

- `STOA_WEBHOOK_PORT`
- `STOA_SESSION_SECRET`
- `STOA_PROJECT_ID`
- `STOA_SESSION_ID`

Those values now come from the lease, not from launch-time hook env.

The dispatcher must treat the lease as the only routing authority.

Request headers it emits are transport copies of lease state, not independent truth.

### Lease Pointer Propagation Contract

`STOA_HOOK_LEASE_PATH` is a mandatory managed-session runtime variable.

This is not optional provider glue. It is part of the architecture contract.

For every managed provider session spawned by STOA:

1. STOA computes the session's canonical lease path
2. STOA injects `STOA_HOOK_LEASE_PATH` into the provider runtime environment
3. every provider hook subprocess or plugin callback must receive that same value unchanged

Canonical-path rules:

- the path must canonicalize to `<stoa-runtime-root>/hook-leases/<session-id>.json`
- the canonicalized path must remain inside `<stoa-runtime-root>/hook-leases`
- symlink, junction, or path-traversal resolution that escapes that directory is invalid
- the dispatcher must reject non-canonical or out-of-root lease pointers as managed-session failure, not as alternate routing input

No managed provider hook surface may depend on:

- `STOA_WEBHOOK_PORT`
- `STOA_SESSION_SECRET`
- `STOA_PROJECT_ID`
- `STOA_SESSION_ID`

for routing correctness.

Those may still exist elsewhere for non-hook runtime needs, but hook dispatch must require only the lease pointer.

### Managed-Session Marker Contract

Managed provider runtimes must also receive a mandatory classification-and-journaling marker set:

- `STOA_HOOK_MANAGED=1`
- `STOA_HOOK_SESSION_ID`
- `STOA_HOOK_PROJECT_ID`
- `STOA_HOOK_PROVIDER`
- `STOA_HOOK_SPAWN_OWNER_INSTANCE_ID`
- `STOA_HOOK_SPAWN_GENERATION`

For managed sessions, propagation of this full marker set is mandatory everywhere `STOA_HOOK_LEASE_PATH` is mandatory.

These marker fields are not routing authority.

They exist only to let the dispatcher:

- distinguish managed-session state loss from unmanaged manual launches
- emit delivery-failure journal records even when the lease cannot be loaded

Managed marker validity rule:

- `STOA_HOOK_MANAGED=1` is valid only when the full marker set above is present and parseable
- the dispatcher must not infer missing stable identity from workspace files, `cwd`, provider config, or provider payload
- a partial or malformed managed marker set is itself a managed-session failure

Authority rule:

- if the lease loads successfully, lease state wins over every marker field
- if the lease loads successfully but stable identity markers `sessionId`, `projectId`, or `provider` disagree with lease state, the dispatcher must treat that as managed-session corruption and fail journaling-safe
- if the lease loads successfully but the invoked provider does not match `lease.provider`, the dispatcher must treat that as managed-session corruption and fail journaling-safe whenever `STOA_HOOK_MANAGED=1`
- `STOA_HOOK_SPAWN_OWNER_INSTANCE_ID` and `STOA_HOOK_SPAWN_GENERATION` are diagnostic provenance only; they may legitimately differ from current lease ownership after reclaim
- if the lease is missing or invalid and `STOA_HOOK_MANAGED=1`, the dispatcher must classify the event as a managed-session failure, not a safe no-context no-op
- if the lease is expired and `STOA_HOOK_MANAGED=1`, the dispatcher must also classify the event as a managed-session failure, not a safe no-context no-op
- if the loaded lease has `leaseState = 'released'` and `STOA_HOOK_MANAGED=1`, the dispatcher must classify the event as a managed-session failure, not a safe no-context no-op
- if `STOA_HOOK_MANAGED=1` and `STOA_HOOK_LEASE_PATH` itself is missing, the dispatcher must also classify the event as a managed-session failure
- if `STOA_HOOK_MANAGED` is absent, the dispatcher may treat missing lease context as unmanaged/no-context

### Runtime Behavior

For every invocation, the dispatcher must:

1. parse stdin as JSON, defaulting to `{}` if parsing fails
2. canonicalize `STOA_HOOK_LEASE_PATH`
3. reject the invocation as managed-session failure if the canonical path is outside `<stoa-runtime-root>/hook-leases`
4. read the lease from that canonical path
5. validate that the lease exists, has `leaseState = 'active'`, and is unexpired
6. validate `lease.provider === <provider>`
7. if managed markers are present, validate they match lease-authoritative `sessionId`, `projectId`, and `provider`
8. if `STOA_HOOK_SPAWN_OWNER_INSTANCE_ID` or `STOA_HOOK_SPAWN_GENERATION` are present and differ from the loaded lease, classify the event as `reclaimed-session provenance` for diagnostics only
9. validate that `lease.webhookBaseUrl` satisfies the local-routing rule
10. derive target URL from `lease.webhookBaseUrl` and `<provider>`
11. supplement `hook_event_name` if the provider body does not already provide one
12. post the request with:
   - `x-stoa-session-id`
   - `x-stoa-project-id`
   - `x-stoa-secret`
13. map the STOA response back into provider-specific hook stdout / exit semantics
14. exit

### Response Mapping Contract

The dispatcher is not only an event forwarder. It is also the response adapter between STOA and provider hook protocols.

The receiver may return:

- no body / no decision
- canonical hook-control JSON
- canonical block / deny / continue instructions
- provider-specific hook payload under an explicit response envelope

The dispatcher must convert that canonical response into the calling provider's native hook contract.

The response wire contract is a single JSON envelope:

```ts
interface HookDispatchResponse {
  mode: 'none' | 'canonical-control' | 'provider-payload'
  control?: {
    action: 'allow' | 'deny' | 'ask' | 'defer' | 'block' | 'continue'
    reason?: string
    hookEventName?: string
    outputText?: string
    updatedInput?: Record<string, unknown>
    updatedPermissions?: Array<Record<string, unknown>>
    message?: string
    interrupt?: boolean
  }
  providerPayload?: {
    provider: 'claude-code' | 'codex' | 'opencode'
    stdoutText?: string
    json?: Record<string, unknown>
  }
}
```

Rules:

- `mode: 'none'`
  means no provider-visible output
- `mode: 'canonical-control'`
  means the dispatcher must translate `control` into the calling provider's native hook contract
- `mode: 'provider-payload'`
  means the dispatcher must use `providerPayload` only when `providerPayload.provider === calling provider`
- a response with `mode: 'provider-payload'` for a different provider is invalid and must be ignored as provider output while still treating delivery as successful

Invalid-combination rule:

- if STOA returns a `mode`, `action`, or field combination that is not explicitly supported for the calling provider and hook event, the dispatcher must suppress provider-visible control output, treat delivery as successful, and record a diagnostic-only managed failure when `STOA_HOOK_MANAGED=1`
- the dispatcher must not invent coercions, best-effort remaps, or provider-private fallback meanings for unsupported combinations
- unsupported semantic control is not a transport failure and must not be translated into terminal-visible noise

Canonical control field intent:

- `action`
  provider-agnostic semantic control verb
- `reason`
  explanation for `block` or `continue` style outcomes
- `updatedInput`
  replacement tool input for permission-style allow flows
- `updatedPermissions`
  permission update entries for providers that support rule mutation
- `message`
  deny feedback text when the provider supports a dedicated deny message field
- `interrupt`
  deny-side interrupt flag when the provider supports it

Delivery-failure rule:

- transport or authorization failures are not semantic hook decisions
- they follow the managed failure semantics and delivery-failure journal rules
- they do not produce provider-visible control output

#### Claude Command Hook Mapping

Claude command hooks are normative here because their behavior depends on command-hook `stdout` and exit codes, not just delivery success.

Rules:

1. if STOA returns no hook-control payload, the dispatcher exits `0` and prints nothing
2. if STOA returns Claude-compatible hook-control JSON, the dispatcher prints that JSON to `stdout` and exits `0`
3. if STOA returns a canonical instruction equivalent to "block/deny/continue working", the dispatcher must translate it into Claude's expected JSON schema for that hook event and print it to `stdout` with exit `0`
4. if delivery fails at the transport/auth/lease layer, the dispatcher follows managed failure semantics: journal the fault, emit no Claude decision payload, and exit `0` without terminal noise
5. the dispatcher must never invent provider behavior outside the documented hook contract for that event

Admissibility rule:

- canonical actions are supported for Claude only where this spec names both the event and the exact admissible action set
- if Claude's current hook contract does not document a concrete synchronous meaning for an action at that event, that action is unsupported here
- `mode: 'none'` means "emit no provider-visible decision"
- `control.action = 'continue'` is reserved only for event contracts where Claude defines an explicit blocking/continue decision surface; it is not a synonym for `mode: 'none'`

Supported canonical-control matrix:

- `PreToolUse`
  - supported actions: `allow`, `deny`
  - unsupported actions: `ask`, `defer`, `block`, `continue`
- `PermissionRequest`
  - supported actions: `allow`, `deny`
  - unsupported actions: `ask`, `defer`, `block`, `continue`
- `Stop`
  - supported actions: `block`, `continue`
  - unsupported actions: `allow`, `deny`, `ask`, `defer`
- `SessionStart`
  - canonical control is unsupported; use `provider-payload` or `mode: 'none'`
- `UserPromptSubmit`
  - canonical control is unsupported unless a future Claude hook contract explicitly documents it
- `PostToolUse`
  - canonical control is unsupported unless a future Claude hook contract explicitly documents it

Field validity rules for Claude canonical-control:

- `updatedInput` and `updatedPermissions` are valid only for `PreToolUse` and `PermissionRequest`
- `message` and `interrupt` are valid only for deny-style `PermissionRequest` outputs
- `reason` is valid only when the Claude event contract has a native field for that reason-bearing decision
- unsupported fields for an otherwise supported event/action pair must be ignored, not reinterpreted

Canonical examples:

- `PreToolUse`
  maps to Claude `hookSpecificOutput.permissionDecision` payloads when STOA wants to allow or deny
- `PermissionRequest`
  maps to Claude `hookSpecificOutput.decision` payloads for allow or deny, including optional `updatedInput`, optional `updatedPermissions`, optional deny `message`, and optional deny `interrupt`
- `Stop`
  map to Claude `{ "decision": "block", "reason": "..." }` when STOA wants Claude to continue working
- `SessionStart`
  map context-bearing text or JSON to Claude command-hook `stdout` semantics when STOA intentionally returns startup context

Non-goal:

- STOA does not need to use Claude decision control for every event, but the dispatcher must faithfully support it for events where STOA chooses to respond with control output

#### Codex Mapping

Codex command hooks use the shared dispatcher but do not require Claude-style decision-control translation.

Rules:

1. if STOA returns no payload, the dispatcher exits `0` and prints nothing
2. if STOA returns a textual or JSON payload intended as hook output, the dispatcher passes that payload through to `stdout` on exit `0`
3. Codex hook delivery success is not defined by provider-side interpretation of structured control output
4. transport/auth/lease failures are handled by the dispatcher's managed failure semantics and produce no `stdout`

Codex validity rule:

- `canonical-control` is unsupported for Codex in this architecture revision
- if STOA returns `mode: 'canonical-control'` for Codex, the dispatcher must emit no `stdout`, treat delivery as successful, and journal the contract mismatch for managed sessions

Directionally, Codex remains `late-bound delivery + deterministic stdout passthrough`, not `decision-control adaptation`.

#### OpenCode Mapping

OpenCode is different because its current plugin surface is event emission, not a synchronous command-hook control plane.

Rules:

1. when OpenCode routes through an in-process plugin callback, successful delivery normally returns no provider-visible payload
2. when OpenCode routes through an in-process plugin callback, dispatcher or receiver response payloads are ignored unless the payload is explicitly consumed by a future OpenCode-specific contract
3. if OpenCode is later routed through a shell-out launcher instead of an in-process plugin callback, it must use the Codex mapping above unless a future spec replaces it
4. hard operational failures are recorded through the managed failure journal and do not rely on provider-native response control

OpenCode validity rule:

- `canonical-control` is unsupported for OpenCode in this architecture revision
- `provider-payload` is unsupported unless `providerPayload.provider === 'opencode'` and a future OpenCode-specific contract explicitly consumes it
- unsupported response content must not be surfaced to the user implicitly

Directionally, OpenCode remains `late-bound delivery + no synchronous control contract` unless its provider surface changes in a future design.

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

Each entry invokes the shared launcher, not a hardcoded local URL.

Claude's command-hook surface must explicitly allow `STOA_HOOK_LEASE_PATH` to reach the hook subprocess.

If Claude requires an allowlist such as `allowedEnvVars`, that allowlist must include `STOA_HOOK_LEASE_PATH`.

The same Claude allowlist must also include the full managed-session marker set:

- `STOA_HOOK_MANAGED`
- `STOA_HOOK_SESSION_ID`
- `STOA_HOOK_PROJECT_ID`
- `STOA_HOOK_PROVIDER`
- `STOA_HOOK_SPAWN_OWNER_INSTANCE_ID`
- `STOA_HOOK_SPAWN_GENERATION`

Claude hook execution must not depend on separately propagating `STOA_SESSION_ID`, `STOA_PROJECT_ID`, or `STOA_SESSION_SECRET`.

### Codex

`.codex/hooks.json` remains command-hook based, but provider-specific `hook-stoa.mjs` is removed.

Codex hooks also invoke the shared launcher directly.

The Codex runtime launched by STOA must receive `STOA_HOOK_LEASE_PATH` in its environment so hook subprocesses inherit it naturally.

Codex hook behavior must not depend on `STOA_WEBHOOK_PORT` or per-event session-secret injection.

### OpenCode

OpenCode continues using its plugin surface, but the plugin no longer owns routing.

The plugin must route through the same lease-aware dispatcher contract. It may shell out to the shared launcher or share the same dispatch runtime internally. The architectural requirement is identical late-bound routing, not a provider-private fetch path.

If the plugin runs inside the managed OpenCode runtime process, that runtime must receive `STOA_HOOK_LEASE_PATH` at spawn time and the plugin must read the lease pointer from there.

OpenCode hook dispatch must not depend on baked webhook URLs or `STOA_WEBHOOK_PORT`.

### Shared Workspace Artifact

`.stoa/hook-dispatch.mjs` plus its launchers are the only workspace runtime bridge.

It is stable and long-lived. It is not rewritten during ordinary webhook port changes.

## Session Lifecycle

### Acquire

Before STOA spawns a provider runtime, it acquires a fresh lease for the session and writes:

- current owner instance
- current webhook base URL
- current session secret
- current expiry window

Acquire must happen under the mutation-lock protocol. If another fresh owner already exists after the post-lock reread, acquire fails.

### Spawn

STOA launches the provider with a stable lease pointer:

- `STOA_HOOK_LEASE_PATH`

Provider hook routing now depends on that pointer alone.

For managed providers, propagation of that pointer into the provider's eventual hook execution context is part of spawn correctness, not an implementation afterthought.

### Dispatch

When a provider hook fires, the dispatcher reads the lease and targets the current STOA owner.

### Heartbeat

While STOA owns the session, it refreshes `heartbeatAt` and `expiresAt`.

Heartbeat must also prove ownership by matching both `ownerInstanceId` and `generation` under the mutation-lock protocol. A stale owner must not be able to refresh over a reclaimed generation.

### Reclaim

If STOA restarts and the previous lease has expired, the new instance reclaims the same lease path with:

- new `ownerInstanceId`
- new `webhookBaseUrl`
- new `sessionSecret`
- incremented `generation`
- `leaseState = 'active'`
- `releasedAt` cleared

Running agents do not need sidecar rewrites for this to work because future hook invocations read the new lease.

Reclaim is valid only after:

1. taking the mutation lock
2. rereading the lease
3. confirming the lease is still expired or `leaseState = 'released'`

If the reread shows a fresh owner, reclaim fails.

### Release

When a session exits, is archived, is deleted, or the app shuts down cleanly, STOA releases the lease by writing a canonical release tombstone.

Release must also run under the mutation-lock protocol so one owner cannot delete a newer generation written by another instance.

The canonical release tombstone keeps:

- `sessionId`
- `projectId`
- `provider`
- `ownerInstanceId`
- `generation`
- `createdAt`

and rewrites:

- `leaseState = 'released'`
- `releasedAt = now`
- `updatedAt = now`
- `heartbeatAt = now`
- `expiresAt = now`
- `sessionSecret = freshly rotated dead secret`

The release path never hands the next owner a still-valid secret.

Authority invariant:

- `leaseState = 'released'` is never an authoritative active lease state
- dispatchers and receivers must reject a released tombstone even if clock skew or equality edge cases would otherwise make `expiresAt` appear current
- `expiresAt = now` on release is a secondary safety belt, not the primary authorization rule

Successor rule:

- a missing lease path -> `acquire`
- an existing released or expired lease path -> `reclaim`

Every successful reclaim must rotate secret and increment generation, including reclaim after a clean release.

## Webhook Authentication Model

The current in-memory-only secret issuance model is insufficient for lease-driven routing.

The webhook receiver must validate the incoming session secret against the active lease state for that session, not only an ephemeral in-memory map.

This can be implemented as:

- a registry-backed authorizer
- or an in-memory cache whose source of truth is the lease registry

The architectural rule is:

`the active session secret accepted by the webhook receiver must match the active session lease`

That keeps secret rotation and reclaim semantics coherent.

### Receiver Authority Rules

The receiver must treat the active lease as authoritative for:

- `sessionId`
- `projectId`
- `provider`
- `sessionSecret`
- `generation`

The receiver must not trust caller-supplied routing identity beyond using `sessionId` as a lookup key.

The validation contract is:

1. read `x-stoa-session-id`
2. load the active lease for that session
3. reject if the lease is missing, released, or expired
4. reject if the request secret does not match `lease.sessionSecret`
5. reject if the receiver endpoint provider does not match `lease.provider`
6. reject if `x-stoa-project-id` does not match `lease.projectId`
7. adapt and ingest the event using lease-authoritative session and project identity

This prevents cross-wire acceptance where a valid secret is paired with the wrong project header or wrong provider endpoint.

## Main Process Responsibilities

### HookLeaseRegistry

Responsible for:

- acquiring leases
- reading leases
- atomic writes
- mutation lock acquisition and stale-lock recovery
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
- `.stoa/hook-dispatch.cmd`
- `.stoa/hook-dispatch`
- `.stoa/hook-contract.json`

It is no longer responsible for carrying current webhook port state into sidecars.

All workspace artifact writes must be:

- atomic replace writes
- idempotent when content is unchanged
- safe under concurrent same-version writers

The installer must never truncate-and-stream shared hook artifacts in place.

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
- verify the installed hook artifact contract version matches the running build

It must stop meaning:

- rewrite sidecars with current webhook port
- repair runtime hook routing by mutating workspace files

It must also refuse managed mutation when the installed workspace contract version differs from the writer's contract version.

The same mismatch must block managed provider startup in that workspace. STOA must not launch managed Claude, Codex, or OpenCode runtimes against known-incompatible installed hook artifacts.

After this architecture lands, runtime port changes are absorbed by lease updates, not by sidecar rewrites.

## Failure Semantics

The dispatcher must default to `terminal-quiet but operationally observable`.

### Safe No-Context No-Op Cases

The dispatcher exits `0` without user-facing error when:

- `STOA_HOOK_LEASE_PATH` is missing
- the lease file does not exist
- the lease file is invalid
- the lease is expired
- `lease.provider` does not match the invoked provider

These cases mean the hook invocation is not attached to an active STOA-owned session.

`lease file missing`, `lease file invalid`, `lease is expired`, and `lease.provider` mismatch qualify as safe no-context only when the dispatcher has no positive managed-session signal for the current provider process.

Managed-session signal is the explicit `STOA_HOOK_MANAGED=1` marker contract described above.

### Managed Dispatch Failure Cases

After a fresh lease is successfully loaded, the following are not considered safe no-ops:

- the lease file is missing for a managed session
- the lease file is invalid for a managed session
- the lease is expired for a managed session
- the lease is released for a managed session
- the invoked provider does not match `lease.provider` for a managed session
- stable identity markers do not match the loaded lease for a managed session
- the webhook target is unreachable
- the webhook responds with unauthorized
- the webhook returns malformed failure responses

These failures must be recorded in an out-of-process shared-runtime delivery failure journal:

```text
<stoa-runtime-root>/hook-delivery-failures.ndjson
```

This journal is normative, not optional. It exists specifically so a dispatcher can record failures even when the target STOA instance is unavailable.

Each failure record must include these keys:

- `sessionId`
- `projectId`
- `ownerInstanceId`
- `generation`
- `provider`
- failure class
- timestamp

Value rule:

- `sessionId`, `projectId`, `ownerInstanceId`, `generation`, and `provider` must be populated from the authoritative lease when it loads successfully
- for lease-load failures, those same keys must still exist in the record even if one or more values are `null`

For lease-load failures:

- `sessionId`, `projectId`, `provider`, `ownerInstanceId`, and `generation` must come from the managed-session marker contract when the lease is unreadable
- if the managed-session marker contract is partial, malformed, or absent, the dispatcher must still record a managed failure but may set unavailable identity fields to `null`
- the record must also include `metadataSource: 'lease' | 'managed-marker'`
- when identity fields are unavailable because the managed marker contract itself is malformed, `metadataSource` must be `managed-marker`
- a malformed managed marker contract must never downgrade the event into a safe no-context no-op

Write semantics:

- one JSON object per line
- append-only
- each append guarded by an exclusive journal write lock
- the dispatcher is allowed to drop duplicate records only if they are byte-identical and adjacent within the same invocation

Consumption semantics:

- STOA may tail, ingest, compact, or rotate this journal later
- delivery failure observability does not depend on the target instance being alive at write time

Normal terminal UX should remain quiet by default, but the failure must not be silent from STOA's perspective.

### Debug Path

When `STOA_HOOK_DEBUG=1` is set, the dispatcher may emit diagnostics to:

- `stderr`
- or a dedicated local debug log

Debuggability must be available, but normal user experience must stay quiet.

### Why This Is Correct

Manual CLI launches in a STOA-managed workspace are often not STOA-owned sessions.

The correct behavior for those cases is a clean no-op, not noisy failure.

Managed sessions with a valid fresh lease are different. Delivery failure there is an operational fault and must be observable to STOA even if the terminal stays quiet.

## Removed Architecture

The following patterns are explicitly removed by this design:

- Claude HTTP sidecar URLs written with a concrete localhost port
- workspace hook files that embed webhook routing state
- provider-specific direct-fetch scripts that bypass lease lookup
- runtime recovery strategies that depend on agents reloading workspace hook files after STOA restart
- cross-build co-management of one workspace with incompatible hook artifact contracts

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
6. Two STOA instances that share the same STOA runtime root may coexist on the same workspace without one sidecar refresh breaking the other's live session routing.
7. Lease acquire, heartbeat, reclaim, and release all use the per-session mutation-lock protocol.
8. A fresh lease blocks hostile or accidental reclaim of the same session by another STOA instance.
9. Reclaim rotates the session secret and invalidates the previous one.
10. Managed dispatch failures after a valid lease is found are observable in STOA-owned diagnostics rather than disappearing as silent no-ops.
11. `STOA_HOOK_LEASE_PATH` is propagated from STOA spawn into Claude, Codex, and OpenCode hook execution contexts as a mandatory contract.
12. Shared workspace hook artifacts are written with atomic replace semantics and idempotent same-content behavior.
13. STOA refuses to co-manage a workspace when the installed hook artifact contract version differs from the running build's contract version.
14. The derivation of `<stoa-runtime-root>` is deterministic across STOA builds and profiles for the same OS user and machine.
15. STOA refuses managed Claude, Codex, and OpenCode session startup in a workspace when hook artifact contract version mismatch is detected.
16. Managed sidecar maintenance remains able to reinstall missing artifacts, but no longer carries runtime port refresh semantics.
17. `sessionId` uniqueness is enforced at the runtime-root boundary, not assumed only within one workspace or project.
18. The dispatcher rejects lease pointers that do not canonicalize into `<stoa-runtime-root>/hook-leases`.
19. Receiver routing refuses non-loopback or otherwise non-local `webhookBaseUrl` lease state.
20. Managed dispatch detects lease-marker mismatches as corruption, not as recoverable alternate routing.
21. Unsupported provider/event response combinations resolve deterministically with suppressed output plus managed diagnostics, not implementation-specific coercion.
22. Lease commit provenance (`commitLockNonce` + `commitToken`) is present in persisted lease state and enforced by the mutation protocol.
23. The repository quality gate still passes after implementation:
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
4. Is the machine-user-scoped shared STOA runtime root the right coordination boundary for multi-instance safety?
5. Is there any requirement for guaranteed event replay while STOA is down that would force a broader transport design?

If the answers remain aligned with the current product intent, this architecture is the correct final direction.
