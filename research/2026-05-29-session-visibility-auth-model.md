---
date: 2026-05-29
topic: session-visibility-and-auth-model
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Session Tree Visibility & Authorization Model

### Why This Was Gathered

Supports the unified session tree implementation (spec at `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`). The task requires mapping the current token/secret/auth infrastructure against the proposed visibility/auth/event-projection rules so implementation can land precisely.

### Summary

The codebase currently has two parallel session hierarchies (work sessions + meta sessions) with three distinct auth mechanisms (hook lease secrets, session secrets in-memory, and a global ctl secret). The unified session tree spec introduces `parentSessionId`-based tree structure and a `same-depth-plus-descendants` visibility rule. This report maps every existing auth/token/secret surface to the spec's requirements and produces spec-ready rules for visibility, auth, event projection, and failure modes.

---

## 1. Current Auth & Token Surface

### 1.1 Hook Lease Secret (per-session, file-backed)

- **Source**: `src/main/hook-lease-registry.ts:7-24` — `SessionHookLease.sessionSecret`
- **Minting**: `createSessionSecret()` at line 547 → `stoa-${randomUUID()}`
- **Lifecycle**: `acquire()` → `heartbeat()` → `release()` (line 128-258)
- **Storage**: File at `<runtimeRoot>/hook-leases/<sessionId>.json` (line 104)
- **Consumers**: Hook endpoints `/hooks/claude-code`, `/hooks/codex`, `/hooks/opencode`
- **Verification**: `webhook-server.ts:341-370` — `authorizeHookRequest` callback, falls back to `getSessionSecret(sessionId)`

### 1.2 Session Secret (per-session, in-memory)

- **Source**: `src/main/session-event-bridge.ts:65` — `Map<string, string> sessionSecrets`
- **Minting**: `issueSessionSecret()` at line 722 → `stoa-${randomUUID()}`
- **Registration**: `registerSessionSecret(sessionId, secret)` at line 728
- **Consumers**: `/events` endpoint via `getSessionSecret` callback (webhook-server.ts:120-121)
- **Verification**: `webhook-server.ts:302-304` — `x-stoa-secret` header match against expected

### 1.3 Ctl Secret (global, file-backed)

- **Source**: `src/main/index.ts:637` — `const metaSessionCtlSecret = generateSecret()`
- **Minting**: `stoa-ctl-port-file.ts:18` — `randomBytes(32).toString('hex')`
- **Storage**: `~/.stoa/ctl.json` (port file) — `PortFileData.secret` (stoa-ctl-port-file.ts:9)
- **Consumers**: All `/ctl/*` endpoints via middleware (meta-session-control-server.ts:164-176)
- **Verification**: `meta-session-control-server.ts:83-96` — `authorize()` function:
  ```ts
  // Either the global ctl secret matches...
  if (expectedSecret && secret === expectedSecret) return true
  // ...or the session ID must exist in the meta session manager
  if (!sessionId) return false
  return metaSessionSource.getSession(sessionId) !== null
  ```

### 1.4 Session Runtime Context (env vars injected into session PTY)

- **Source**: `src/core/meta-session-command-env.ts` — builds env for meta sessions
- **Fields**: Currently meta-session-specific. Spec requires generalizing to:
  - `STOA_SESSION_ID`
  - `STOA_CTL_SESSION_TOKEN` (not yet implemented)
  - `STOA_CTL_BASE_URL` (partially via port file discovery)
- **Injection point**: `session-runtime.ts:70-89` — `ProviderCommandContext` object
- **Key existing fields**: `sessionSecret`, `providerPort`, `hookLeasePath`, `hookManaged`, `hookSessionId`, `hookProjectId`, `hookProvider`, `hookSpawnOwnerInstanceId`, `hookSpawnGeneration`

### 1.5 Launch Token (per-session, in-memory, prevents stale exit handling)

- **Source**: `src/main/index.ts:513-523` — `sessionLaunchTokens` map
- **Purpose**: Monotonic counter per session; stale PTY exit callbacks are silently dropped (session-runtime.ts:153-157)
- **Not auth**: This is a race-condition guard, not an authorization mechanism

---

## 2. Visibility Rules (Spec-Ready)

The visibility rule `V(S)` is defined in the spec and applies uniformly at all depths.

### 2.1 Definition

For a session `S` at depth `d` in tree `T`:

```
V(S) = { S } ∪ { P ∈ T | depth(P) = d } ∪ { D ∈ T | D is a descendant of S }
```

### 2.2 Required Data (all derived, not persisted)

| Field | Source | Derivation |
|-------|--------|------------|
| `rootSessionId` | Spec: from `parentSessionId` chain | Walk `parentSessionId` until `null` |
| `depth` | Spec: from `parentSessionId` chain | Count edges to root |
| `childSessionIds` | Spec: from sessions with `parentSessionId = S.id` | Filter current project sessions |
| `descendantCount` | Spec: recursive child count | Traverse subtree |

### 2.3 Visibility Function Pseudocode

```ts
function computeVisibility(callerId: string, allSessions: SessionSummary[]): Set<string> {
  const caller = allSessions.find(s => s.id === callerId)
  if (!caller) return new Set()

  const rootId = findRoot(caller, allSessions)
  const tree = allSessions.filter(s => findRoot(s, allSessions) === rootId)
  const callerDepth = computeDepth(caller, allSessions)

  const visible = new Set<string>()
  for (const session of tree) {
    const depth = computeDepth(session, allSessions)
    // Same depth peer
    if (depth === callerDepth) visible.add(session.id)
    // Descendant of caller
    if (isDescendant(session, caller, allSessions)) visible.add(session.id)
  }
  return visible
}
```

### 2.4 Spec Examples (verified against spec)

```
R(0)
├─ A(1)
│  └─ A1(2)
│     └─ A1a(3)
└─ B(1)
   └─ B1(2)
      └─ B1a(3)
```

| Caller | Visible | Invisible |
|--------|---------|-----------|
| R | R, A, B, A1, B1, A1a, B1a | (none — root sees everything) |
| A | A, B, A1, A1a | R, B1, B1a |
| B | A, B, B1, B1a | R, A1, A1a |
| A1 | A1, B1, A1a | R, A, B, B1a |
| B1 | A1, B1, B1a | R, A, B, A1a |
| A1a | A1a, B1a | R, A, B, A1, B1 |

---

## 3. Auth Rules (Spec-Ready)

### 3.1 Caller Types

| Caller Type | Identification | Evidence Location |
|-------------|---------------|-------------------|
| **Local user** | `x-stoa-secret` matches global ctl secret | meta-session-control-server.ts:89 |
| **Session** | `x-stoa-session-id` + `x-stoa-session-token` | Spec requirement, not yet in code |

**Current gap**: The `authorize()` function at meta-session-control-server.ts:83-96 uses session existence in `metaSessionSource` as the second auth path. The spec requires replacing this with a per-session `STOA_CTL_SESSION_TOKEN` that is:
- Minted at runtime start
- Stored only in-memory (not persisted)
- Invalidated at runtime stop/destroy
- Not inherited by child sessions

### 3.2 Authority Matrix (Session Caller)

| Action | self | same-depth peers | descendants | ancestors | peer descendants | other trees |
|--------|------|------------------|-------------|-----------|------------------|-------------|
| `inspect` | YES | YES | YES | NO | NO | NO |
| `prompt` | YES | YES | YES | NO | NO | NO |
| `create` | YES (direct child only) | NO | NO | NO | NO | NO |
| `destroy` | YES | NO | YES | NO | NO | NO |

### 3.3 Authority Matrix (Local User Caller)

All actions allowed on all sessions. No visibility filtering.

### 3.4 Auth Enforcement Points

Each `/ctl/*` route in the control server must:

1. **Resolve caller type** — from `x-stoa-secret` (global) vs `x-stoa-session-id` + `x-stoa-session-token`
2. **Compute visibility set** — if session caller, compute `V(S)`
3. **Check target in visibility** — reject with `unknown_session` if not visible
4. **Check action authority** — reject with `forbidden_authority_scope` if visible but not authorized

---

## 4. Event Projection Rules (Spec-Ready)

### 4.1 Session Graph Event Envelope

```ts
interface SessionGraphEvent {
  kind: 'created' | 'updated' | 'archived' | 'restored' | 'destroyed'
  graphVersion: number              // monotonic, for dedup
  origin: 'renderer' | 'local-cli' | 'session' | 'system'
  initiatorSessionId: string | null // who caused this event
  node: SessionNodeSnapshot         // full snapshot after mutation
}
```

### 4.2 Projection to Renderer

| Rule | Detail |
|------|--------|
| Renderer sees all | No visibility filtering for renderer push events |
| `session:event` is universal upsert | `upsertSession()` — insert if unknown, update if known |
| Background child creation triggers push | Parent auto-expand, but no active session switch |
| `graphVersion` dedup | Renderer rejects events with `graphVersion <= lastSeen` |
| `SessionNodeSnapshot` is transport unit | Contains derived `tree` metadata (root, depth, child counts) |

### 4.3 Projection to Session Caller (via stoa-ctl)

| Command | Filtering |
|---------|-----------|
| `session list` | Return only `V(S)` nodes |
| `session inspect <id>` | Reject if `id ∉ V(S)` |
| `session inspect <id> --view tree` | Return caller-filtered subtree view |
| `session prompt <id>` | Reject if `id ∉ V(S)` or action unauthorized |
| `session create` | Always creates as direct child of caller |
| `session destroy <id>` | Reject if `id` is same-depth peer |

### 4.4 Projection to CLI (local user)

No filtering. Full global access.

### 4.5 Current Infrastructure Gaps

| Gap | Current State | Required State |
|-----|--------------|----------------|
| Session tree metadata | Not derived; sessions are flat | `SessionVisibilityService` computes root/depth/visibility |
| `parentSessionId` field | Not on `SessionSummary` | Added to `SessionSummary` and `PersistedSession` |
| Per-session control token | Not implemented | `SessionCallerAuthRegistry` mints at runtime start |
| `session:event` as upsert | Current `SessionSummaryEvent` is update-only | Must handle unknown session inserts |
| `graphVersion` | Not tracked | Monotonic counter in `SessionSupervisor` |
| Background child push | `sessionCreate` IPC returns to caller only | `SessionGraphEvent` broadcast to renderer |

---

## 5. Failure Modes (Spec-Ready)

### 5.1 Error Contract

| Error Code | HTTP Status | Condition |
|-----------|-------------|-----------|
| `unknown_session` | 404 | Target not visible to caller OR target does not exist |
| `unknown_project` | 404 | Referenced project does not exist |
| `forbidden_visibility_scope` | 403 | Target exists but is outside caller's visibility set (internal use; externally surfaced as `unknown_session` to prevent probing) |
| `forbidden_authority_scope` | 403 | Target visible but caller lacks authority for the specific action |
| `invalid_parent_session` | 400 | `parentSessionId` references a non-existent or cross-project session |
| `cross_project_parent_forbidden` | 400 | Attempt to create child with parent in different project |
| `invalid_secret` | 401 | Auth headers missing or incorrect |
| `session_not_live` | 403 | Session caller exists but runtime is stopped/archived |
| `internal_error` | 500 | Unexpected server error |

### 5.2 Visibility Leakage Prevention

**Critical rule**: When a session caller requests an action on a target:
- If target `∉ V(S)` → return `unknown_session` (same response as if target doesn't exist)
- If target `∈ V(S)` but action unauthorized → return `forbidden_authority_scope`

This prevents using error codes to probe for the existence of invisible sessions.

### 5.3 Runtime Failure Modes

| Scenario | Source | Behavior |
|----------|--------|----------|
| Session PTY exits during start | session-runtime.ts:176-178 | `markRuntimeAlive` skipped, session stays in `starting` |
| Stale exit callback | session-runtime.ts:153-157 | Silently dropped via launch token check |
| Lease expired | hook-lease-registry.ts:260-262 | `isExpired()` returns true, heartbeat/reclaim fails |
| Webhook secret mismatch | webhook-server.ts:303-304 | 401 with `invalid_secret` |
| Hook context missing | webhook-server.ts:337-339 | 400 with `invalid_hook_context` |
| Codex external session rebind | session-event-bridge.ts:255-253 | Trusted only if matches launch intent or `clear` source |

### 5.4 Tree Integrity Failure Modes

| Scenario | Prevention |
|----------|------------|
| Orphan session after destroy | Spec: recursive subtree destroy, leaf-first |
| Cross-project parent | `cross_project_parent_forbidden` check at create |
| Cycle in parent chain | `parentSessionId` must point to existing session in same project; root must be reachable |
| Lost child after destroy | No reparent; entire subtree archived together |
| Stale auth token | Token invalidated at runtime stop; not persisted |

---

## Evidence Chain

| # | Finding | Source | Location |
|---|---------|--------|----------|
| 1 | Session secrets are UUID-based, minted per-session, stored in-memory | session-event-bridge.ts | :65, :722-726 |
| 2 | Hook leases are file-backed with commit-lock mutation pattern | hook-lease-registry.ts | :128-158 |
| 3 | Global ctl secret is 32-byte hex, stored in port file | stoa-ctl-port-file.ts | :9, :18 |
| 4 | Current authorize() uses global secret OR session existence | meta-session-control-server.ts | :83-96 |
| 5 | ProviderCommandContext carries sessionSecret to runtime | session-runtime.ts | :70-89 |
| 6 | Launch tokens prevent stale exit handling | session-runtime.ts | :153-157 |
| 7 | SessionSummary has no parentSessionId yet | project-session.ts | :122-145 |
| 8 | MetaSessionSummary is separate parallel model | meta-session.ts | :13-28 |
| 9 | Spec defines V(S) = self + same-depth peers + descendants | spec doc | :249-318 |
| 10 | Spec defines authority matrix with inspect/prompt/create/destroy | spec doc | :342-359 |
| 11 | Spec requires SessionCallerAuthRegistry with per-session tokens | spec doc | :631-668 |
| 12 | Spec requires SessionVisibilityService for centralized visibility | spec doc | :672-679 |
| 13 | Webhook auth uses x-stoa-secret header against session secret | webhook-server.ts | :302-304 |
| 14 | Hook auth uses authorizeHookRequest or fallback to session secret | webhook-server.ts | :341-370 |
| 15 | Spec requires visibility leakage prevention via error code uniformity | spec doc | :363-367 |
| 16 | SessionGraphEvent with graphVersion is required renderer sync mechanism | spec doc | :769-780 |
| 17 | ProjectSessionManager manages all work sessions in flat structure | project-session-manager.ts | :260-801 |
| 18 | Spec mandates parentSessionId on SessionSummary as only authority relation | spec doc | :144-155 |

---

## Risks / Unknowns

- **[!] Token migration**: Current auth uses session existence in meta-session manager. Removing meta sessions requires a new per-session token minting mechanism that doesn't yet exist in code.
- **[!] Visibility computation cost**: Computing `V(S)` requires walking the full session tree. For deep trees with many sessions, this may need caching or indexing. Currently no indexing exists.
- **[!] Renderer upsert gap**: Current `SessionSummaryEvent` assumes sessions are known. The `upsertSession` semantic for background child creation is a behavior change in the renderer store that must be tested carefully.
- **[?] stoa-ctl CLI caller resolution**: The spec describes two caller types (session vs local user) resolved by env vars. The current `stoa-ctl` CLI tool (tools/stoa-ctl/) needs full rewrite of caller resolution logic.
- **[?] Hook lease and session secret interaction**: Currently hook leases have their own secret, and SessionEventBridge has a separate in-memory map. The spec doesn't explicitly address whether the per-session control token replaces, coexists with, or subsumes the hook lease secret.
- **[?] Cross-tree visibility**: Spec explicitly says "no cross-tree visibility." This is a hard boundary but means a session in tree A cannot even discover sessions in tree B via stoa-ctl. This is by design but may surprise users who expect global search.
