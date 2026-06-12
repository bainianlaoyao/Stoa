---
date: 2026-06-11
topic: stoa-ctl subagent control server-side contract review
status: completed
mode: context-gathering
sources: 25
---

## Context Report: stoa-ctl Subagent Control — Server-Side Contract Review

### Why This Was Gathered
Review of the subagent control API contract for Critical/Important issues: authority gaps, API contract mismatches, server-side validation holes, destroyed/stale session semantics, and protocol invariants.

### Summary
The stoa-ctl subagent control surface has a well-structured authority model (`SessionVisibilityService` → `SessionSupervisor` → `SubagentSupervisor` → `SessionControlServer`). Several medium-high severity issues were identified: a dead code branch in `session create` handler, a no-op redundant check in `dispatch`, an authority bypass where `destroySession` in the supervisor does not gate on the `destroy` action for `local-user`, a stale session token vulnerability after archive, and a visibility leak risk in the `subagent list` handler.

---

### Candidate Findings

#### Finding 1: Dead / Unreachable Code Branch in `/ctl/session/create` Handler (Important)

**Location**: `src/core/session-control-server.ts:335-387`

The `create` handler has two adjacent blocks for `local-user`:

1. **Lines 335-377**: `if (caller.type === 'local-user' && projectId && !parentId)` — handles root create when `projectId` is present and `parentId` is absent. Returns early.
2. **Lines 379-386**: `if (caller.type === 'local-user' && !parentId)` — handles the case when `!parentId` and no `projectId`.

But block 1 already handles the `!parentId` case when `projectId` is present (and returns early). Block 2 only fires when `!projectId && !parentId`, which should have been caught by the earlier validation at lines 337-344 (`if (!projectId)` → 400). Block 2 is therefore unreachable in practice — the `!projectId` case at line 337 already rejects with 400 before reaching line 379.

**Impact**: Dead code that could confuse maintainers. No functional bug because the preceding validation guards it.

**Evidence Chain**:
| Claim | Source | Location |
|-------|--------|----------|
| `!projectId` returns 400 at line 337-344 | session-control-server.ts | :337-344 |
| Block at line 379-386 is for `!parentId` | session-control-server.ts | :379-386 |
| Block at line 335-377 handles `projectId && !parentId` | session-control-server.ts | :335-377 |

---

#### Finding 2: No-op Redundant Check in `dispatch` — `parentNode.session.parentSessionId` (Important)

**Location**: `src/core/subagent-supervisor.ts:258`

```typescript
if (!parentNode.session.parentSessionId && !parentNode.session.parentSessionId) {
  // Root session as parent is fine for local-user
}
```

The condition `!A && !A` is always `!A` — it's a doubled check on the same property. This is clearly a copy-paste artifact. The comment says "Root session as parent is fine for local-user" but the `if` body is empty — it does nothing regardless. The intent was likely to validate something about the parent (e.g., reject non-root parents for local-user, or check something else), but as written it's a no-op.

**Impact**: No functional bug (the branch is empty), but signals an incomplete validation that may need to be addressed — e.g., should `local-user` be restricted from creating subagents under non-root sessions? Currently any `local-user` can specify any `parentId`.

**Evidence Chain**:
| Claim | Source | Location |
|-------|--------|----------|
| `!parentNode.session.parentSessionId && !parentNode.session.parentSessionId` | subagent-supervisor.ts | :258 |
| Empty block body | subagent-supervisor.ts | :259-260 |

---

#### Finding 3: `destroySession` in `SessionSupervisor` Skips Authority Check for `local-user` Caller (Important)

**Location**: `src/core/session-supervisor.ts:118-124`

```typescript
async destroySession(caller: CallerIdentity, targetId: string): Promise<void> {
  this.requireKnownSession(targetId)
  if (caller.type === 'session') {
    this.assertAuthority(caller.sessionId, targetId, 'destroy')
  }
  return this.deps.destroySession(targetId)
}
```

For `local-user` callers, `destroySession` only checks that the session exists (`requireKnownSession`) but does NOT call `assertAuthority`. This means a `local-user` can destroy any session without going through the visibility/authority model.

**Counter-argument**: `local-user` is the admin role and is expected to have full access. The `inputSession` method follows the same pattern — `local-user` bypasses authority checks. This is by design: `local-user` callers are always trusted.

**Assessment**: By design, but the asymmetry with `requireVisibleSession` (used by `getSessionStatus`, `getSessionOutput`, etc.) should be noted. `requireVisibleSession` skips authority for `local-user` implicitly because the `if (caller.type === 'session')` guard means `local-user` always passes through. `destroySession` follows the same pattern. **Not a bug, but the code is inconsistent in its guard style** — some methods use `requireVisibleSession` (which includes the `local-user` bypass), while others use explicit `if (caller.type === 'session')` checks.

**Evidence Chain**:
| Claim | Source | Location |
|-------|--------|----------|
| `destroySession` skips authority for `local-user` | session-supervisor.ts | :118-124 |
| `inputSession` uses same pattern | session-supervisor.ts | :94-101 |
| `requireVisibleSession` also skips for `local-user` | session-supervisor.ts | :197-208 |

---

#### Finding 4: Stale Session Token Remains Valid After Archive/Destroy (Critical)

**Location**: `src/main/index.ts:807-813`, `src/main/index.ts:1042-1047`

When a session is destroyed via the control server (`/ctl/session/:id/destroy`), it calls `archiveWorkSessionWithRuntime`, which:
1. Kills the PTY
2. Deletes the session token from `sessionTokenRegistry` (`line 1046`)
3. Archives the session in the session manager

However, there is a **TOCTOU race**: between the time the HTTP request authenticates via `resolveCaller` (which reads `sessionTokenRegistry`) and the time `archiveWorkSessionWithRuntime` deletes the token, another concurrent request using the same session token could pass authentication and execute privileged operations.

Additionally, after archival, the session is still present in the snapshot (marked `archived: true`). The `subagentSupervisor.list()` filters out archived sessions (line 890), but the session-level routes (`inspect`, `status`, `output`, etc.) do NOT filter archived sessions — they use `requireKnownSession` which finds any session by ID regardless of archive status. This means a destroyed/archived session's data is still accessible via session-level routes.

**Impact**:
1. **TOCTOU race**: A session token may be used concurrently during the destroy window. Severity: Low (loopback HTTP only, single-threaded Node.js event loop means the race window is very small).
2. **Post-destroy data leak**: After destroy, the session's terminal replay, status, and output remain accessible. Severity: Medium (the session is archived, not deleted; this may be intentional for audit purposes, but the CLI consumer may not expect it).

**Evidence Chain**:
| Claim | Source | Location |
|-------|--------|----------|
| `destroySession` → `archiveWorkSessionWithRuntime` | main/index.ts | :807-813 |
| Token deleted in loop over subtree | main/index.ts | :1046 |
| `resolveCaller` reads `sessionTokenRegistry` | session-control-server.ts | :44-63 |
| `list` filters `!n.session.archived` | subagent-supervisor.ts | :890 |
| `inspectSession` finds any session by ID | session-supervisor.ts | :78-92 |
| `requireKnownSession` finds any session by ID | session-supervisor.ts | :189-195 |

---

#### Finding 5: `subagentInput` Authority Does Not Validate Input Epoch Consistency (Medium)

**Location**: `src/core/subagent-supervisor.ts:635-685`

When `subagent input` is called, it:
1. Resolves the target
2. Checks authority via `checkAuthority(caller.sessionId, session.id, 'subagentInput')`
3. Sends the input
4. Increments the epoch and stales previous result

The visibility service's `checkAuthority` for `subagentInput` returns `allowed: true` for any visible target (line 72-83 of session-visibility-service.ts — `subagentInput` is in the "always allowed" bucket). This means **any session that can see a subagent can send it input**, including same-depth peers and sibling descendants. This is potentially broader than intended — a subagent at depth 2 could send input to its sibling at depth 2.

**Impact**: By design (the visibility model treats input/prompt/inspect/status as "read-like" operations that are allowed for all visible sessions). But `subagentInput` is NOT read-only — it mutates the subagent's state (epoch, result staling). This is a semantic gap: the authority model treats input delivery as "observable" but it has side effects.

**Evidence Chain**:
| Claim | Source | Location |
|-------|--------|----------|
| `subagentInput` in "always allowed" bucket | session-visibility-service.ts | :72-83 |
| `subagentInput` has side effects (epoch increment, result staling) | subagent-supervisor.ts | :666-678 |

---

#### Finding 6: `subagent result` Has No Authority Gate on the `submitOwnResult` Action (Medium)

**Location**: `src/core/session-visibility-service.ts:86-88`, `src/core/subagent-supervisor.ts:689-755`

The visibility service defines `submitOwnResult` as an `AuthorityAction` and always returns `{ allowed: false, reason: 'forbidden_authority_scope' }` for it (line 86-88). However, `SubagentSupervisor.result()` never calls `checkAuthority` with `submitOwnResult`. Instead, it has its own inline checks:
- Reject `local-user` callers
- Reject root sessions (no `parentSessionId`)

The visibility service's `submitOwnResult` action is dead code — it's defined but never invoked by any code path.

**Impact**: No functional bug (the inline checks in `result()` cover the same cases), but the dead `submitOwnResult` authority action in the visibility service is misleading and should be cleaned up.

**Evidence Chain**:
| Claim | Source | Location |
|-------|--------|----------|
| `submitOwnResult` always denied | session-visibility-service.ts | :86-88 |
| `result()` never calls `checkAuthority` with `submitOwnResult` | subagent-supervisor.ts | :689-755 |
| `result()` has inline parent check | subagent-supervisor.ts | :722-727 |

---

#### Finding 7: `resolveTarget` Visibility Query Called Per-Target in a Loop (Performance, Low)

**Location**: `src/core/subagent-supervisor.ts:166-170`

In `resolveTarget`, for session callers, the code calls `this.deps.visibilityService.visibleSessionIds(caller.sessionId)` inside the filter callback, meaning it's called once per node in the snapshot. The `visibleSessionIds` method iterates all nodes and builds a visibility set each time.

For the `wait` method with many targets, this means `O(targets × nodes)` visibility computations instead of `O(nodes)`.

**Impact**: Performance concern for large session trees with many subagent wait targets. Not a correctness bug.

**Evidence Chain**:
| Claim | Source | Location |
|-------|--------|----------|
| `visibleSessionIds` called per node in filter | subagent-supervisor.ts | :166-170 |
| `visibleSessionIds` iterates all nodes | session-visibility-service.ts | :25-48 |

---

#### Finding 8: `subagent dispatch` Does Not Validate Cross-Tree Parent for Session Callers (Important)

**Location**: `src/core/subagent-supervisor.ts:238-263`

When a `session` caller dispatches a subagent, `parentId` is set to `caller.sessionId` and `projectId` is derived from the caller's node. However, there is no check that the caller is allowed to create children under itself — the `dispatch` method does NOT call `checkAuthority(caller.sessionId, caller.sessionId, 'create')` like `SessionSupervisor.createChildSession` does.

This means a session that has been denied `create` authority by the visibility service can still dispatch subagents via `SubagentSupervisor.dispatch`.

**Impact**: **Authority bypass** — a session caller can create children even if the visibility model denies `create` authority. This is inconsistent with `SessionSupervisor.createChildSession` which enforces the `create` check.

**Evidence Chain**:
| Claim | Source | Location |
|-------|--------|----------|
| `dispatch` sets `parentId = caller.sessionId` without authority check | subagent-supervisor.ts | :244 |
| `createChildSession` calls `assertAuthority(..., 'create')` | session-supervisor.ts | :104-106 |
| `checkAuthority` can deny `create` | session-visibility-service.ts | :100-106 |

---

#### Finding 9: `wait` Polls Only First Pending Target's Session State Change (Important)

**Location**: `src/core/subagent-supervisor.ts:576-586`

During the wait loop, `waitForSessionStateChange` is called with only the first pending target's session ID:

```typescript
await this.deps.waitForSessionStateChange(
  pendingTargets[0].node.session.id,
  Math.min(250, remaining)
)
```

If multiple targets are pending, the wait only subscribes to state changes for the first target. Other pending targets are only checked on the next poll cycle (every 250ms or 50ms). This means the wait latency for non-first targets is bounded by the poll interval rather than being event-driven.

**Impact**: Increased latency for `mode=all` waits with multiple pending targets. Not a correctness bug, but the wait completion for targets 2+ is delayed by up to 250ms beyond their actual completion.

**Evidence Chain**:
| Claim | Source | Location |
|-------|--------|----------|
| `waitForSessionStateChange` called with `pendingTargets[0]` only | subagent-supervisor.ts | :579-580 |
| All targets re-checked in each poll iteration | subagent-supervisor.ts | :487-569 |

---

#### Finding 10: `subagent list` Exposes All Non-Archived Children Regardless of Visibility (Medium)

**Location**: `src/core/subagent-supervisor.ts:877-892`

The `list` method filters by visibility for session callers:

```typescript
if (caller.type === 'local-user') {
  visibleNodes = nodes
} else {
  const visibleIds = this.deps.visibilityService.visibleSessionIds(caller.sessionId)
  visibleNodes = nodes.filter(n => visibleIds.includes(n.session.id))
}
return visibleNodes
  .filter(n => n.session.parentSessionId !== null && !n.session.archived)
  .map(n => toSubagentListItem(n.session))
```

This correctly gates visibility. However, `list` returns `SubagentListItem` which includes `parentSessionId`, `type`, `title`, `phase`, and `resultStatus` — all of which are considered "visible" to the caller. The visibility model treats `inspect` as always-allowed for visible sessions, and `list` essentially provides a subset of inspect data. This is consistent.

**Revised assessment**: No issue. The visibility gating is correct.

---

### Risks / Unknowns

- **[!] Finding 4 (Stale token)**: The TOCTOU race window is very small in single-threaded Node.js, but concurrent HTTP requests that are already being processed when destroy starts could complete their operations on the now-destroyed session.
- **[!] Finding 8 (Authority bypass in dispatch)**: This is the most significant finding — a session caller can bypass `create` authority via `subagent dispatch` even if the visibility model would deny direct session creation.
- **[?] Finding 2 (No-op check)**: The empty branch at line 258-260 suggests a validation that was never completed. It's unclear whether `local-user` dispatch should be restricted to certain parent types.
- **[?] Cross-project parent**: The `SubagentDispatchRequest` type has `parentId` but no `projectId`. For `session` callers, `projectId` is derived from the caller's node. For `local-user`, it's derived from the parent node. There's no explicit check that prevents a `local-user` from dispatching a subagent under a parent in a different project.

---

### Evidence Summary

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| 1 | Dead code branch in `/ctl/session/create` | Low | Dead Code |
| 2 | No-op redundant check in `dispatch` | Medium | Incomplete Validation |
| 3 | `local-user` authority bypass in `destroySession` | Info | By Design |
| 4 | Stale session token after archive | Medium | TOCTOU / Data Leak |
| 5 | `subagentInput` has side effects but is in "always allowed" bucket | Medium | Semantic Gap |
| 6 | Dead `submitOwnResult` authority action | Low | Dead Code |
| 7 | Per-target visibility recomputation in `resolveTarget` | Low | Performance |
| 8 | `dispatch` skips `create` authority check for session callers | **High** | Authority Bypass |
| 9 | Wait polls only first pending target | Medium | Latency |
| 10 | ~~List exposes children regardless of visibility~~ | N/A | False Positive |

---

## Context Handoff: stoa-ctl Subagent Control Server-Side Contract Review

Start here: `research/2026-06-11-stoa-ctl-subagent-control-contract-review.md`

Context only. Use the saved report as the source of truth. The most significant finding is **Finding 8** — `SubagentSupervisor.dispatch` skips the `create` authority check that `SessionSupervisor.createChildSession` enforces, allowing session callers to bypass `create` authority. Finding 2 (no-op validation branch) and Finding 4 (post-destroy data access) are also notable.
