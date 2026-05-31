---
date: 2026-05-29
topic: impl-session-types-subagent
status: completed
mode: context-gathering
sources: 8
---

## Context Report: Session Tree Type Extensions for `src/shared/project-session.ts`

### Why This Was Gathered
Support bounded implementation of `parentSessionId` / `createdBySessionId` on `SessionSummary` and `PersistedSession` — identify exactly which types, mappers, and tests must change before touching code.

### Summary
Two exported interfaces need direct extension: `SessionSummary` (runtime/read model) and `PersistedSession` (disk format). Both need `parentSessionId: string | null` and `createdBySessionId: string | null`. Three mappers bridge them (`toPersistedSession`, `toSessionSummary`, plus the `SessionTreeMeta` read projection). Four test fixtures and one `buildSessionPresenceSnapshot` call site need updating.

### Key Findings

#### 1. Types that MUST change

**`SessionSummary`** (`src/shared/project-session.ts:122-145`)
- Currently has no `parentSessionId` or `createdBySessionId` fields
- Design doc specifies both should be added as `string | null`
- This is the runtime/view-layer type used everywhere downstream

**`PersistedSession`** (`src/shared/project-session.ts:163-186`)
- Snake_case disk format counterpart to `SessionSummary`
- Needs `parent_session_id` and `created_by_session_id` fields added
- Controls what gets written to and read from disk

**`CreateSessionRequest`** (`src/shared/project-session.ts:279-286`)
- May need `parentSessionId?: string` field to allow callers to specify parent at creation time

**New read projection type** (per design doc lines 167-178)
```ts
interface SessionTreeMeta {
  rootSessionId: string
  depth: number
  childCount: number
  descendantCount: number
}
interface SessionNodeSnapshot {
  session: SessionSummary
  tree: SessionTreeMeta
}
```
- `SessionTreeMeta` is NOT persisted —主机侧 only
- `rootSessionId` and `depth` are derived, not stored

#### 2. Existing fields that encode lifecycle (align with, do NOT duplicate)

| Field | Source | Location | Encodes |
|-------|--------|----------|---------|
| `externalSessionId` | `SessionSummary` | project-session.ts:140 | External runtime identity; used by `confidenceForSession` and `recoveryPointerStateForSession` as authority signal (`observability-projection.ts:211-217`) |
| `createdAt` | `SessionSummary` | project-session.ts:141 | Creation timestamp; tree depth should align here |
| `archived` | `SessionSummary` | project-session.ts:144 | Soft-delete semantics; `parentSessionId != null` children of archived parents should behave consistently |
| `runtimeState` | `SessionSummary` | project-session.ts:126 | `created`/`starting`/`alive`/`exited`/`failed_to_start`; tree semantics (e.g., "subtree restore") must respect this |
| `turnEpoch` | `SessionSummary` | project-session.ts:128 | Turn counter; audit trail (`createdBySessionId`) should match who holds this counter |
| `lastStateSequence` | `SessionSummary` | project-session.ts:135 | Event sequence for idempotent reducer; tree patch propagation must preserve sequence monotonicity |

**Constraint from design doc (lines 154-159):**
- `parentSessionId` = authoritative hierarchy (writes)
- `createdBySessionId` = audit only, does NOT affect visibility, permissions, or tree projection
- `rootSessionId` = derived, not persisted
- `depth` = derived, not persisted
- `childSessionIds` = derived (host-side projection), not persisted

#### 3. Tests and downstream types that will break or need extension

**Test fixtures that directly construct `SessionSummary`:**

| File | Location | Lines | Impact |
|------|----------|-------|--------|
| `src/shared/project-session.test.ts` | Factory function | 22-50 | Must add `parentSessionId: null` and `createdBySessionId: null` to all session objects |
| `src/shared/session-state-reducer.test.ts` | Factory function | 22-48 | Same as above; also all inline `session()` call sites |

**Mappers that must propagate new fields:**

| File | Function | Location | Impact |
|------|----------|----------|--------|
| `src/core/project-session-manager.ts` | `toPersistedSession` | lines 62-87 | Must copy `session.parentSessionId → persistedSession.parent_session_id` and `session.createdBySessionId → persistedSession.created_by_session_id` |
| `src/core/project-session-manager.ts` | `toSessionSummary` | lines 89-114 | Must read `persistedSession.parent_session_id → session.parentSessionId` and `persistedSession.created_by_session_id → session.createdBySessionId` |
| `src/shared/observability-projection.ts` | `buildSessionPresenceSnapshot` | lines 51-108 | Reads `session.*` fields — no structural change needed but callers may pass `parentSessionId`/`createdBySessionId` now |

**Call site that constructs `SessionSummary` at creation:**

| File | Location | Lines | What to add |
|------|----------|-------|-------------|
| `src/core/project-session-manager.ts` | `createSession()` | 499-517 | New object literal needs `parentSessionId: request.parentSessionId ?? null` and `createdBySessionId: null` (or pass-through from request) |

**Downstream consumers of `SessionSummary` fields (no type changes, but verify no hardcoded field count):**

- `src/shared/session-state-reducer.ts:65-209` — `reduceSessionState` spreads `SessionSummary`; verify no field-count assertions
- `src/shared/observability-projection.ts` — `buildSessionPresenceSnapshot` reads 20+ fields; tree fields are orthogonal
- `src/renderer/stores/workspaces.ts` — Pinia store cascading; tree fields pass through

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| `SessionSummary` current fields | `src/shared/project-session.ts` | lines 122-145 |
| `PersistedSession` current fields | `src/shared/project-session.ts` | lines 163-186 |
| `toPersistedSession` mapper | `src/core/project-session-manager.ts` | lines 62-87 |
| `toSessionSummary` mapper | `src/core/project-session-manager.ts` | lines 89-114 |
| `createSession` constructs `SessionSummary` | `src/core/project-session-manager.ts` | lines 499-517 |
| `CreateSessionRequest` current shape | `src/shared/project-session.ts` | lines 279-286 |
| Design spec: new fields | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 147-159 |
| Design spec: SessionTreeMeta read model | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 167-178 |
| Design spec: derived-not-persisted constraint | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 154-159 |
| Test fixture: project-session.test.ts | `src/shared/project-session.test.ts` | lines 22-50 |
| Test fixture: session-state-reducer.test.ts | `src/shared/session-state-reducer.test.ts` | lines 22-48 |
| `buildSessionPresenceSnapshot` call site | `src/shared/observability-projection.ts` | lines 51-108 |
| `confidenceForSession` uses `externalSessionId` | `src/shared/observability-projection.ts` | lines 211-213 |
| `recoveryPointerStateForSession` uses `externalSessionId` | `src/shared/observability-projection.ts` | lines 215-217 |

### Risks / Unknowns
- [!] `PersistedSession` version bump needed? `PersistedProjectSessions.version` is currently `6` — if schema changes, version may need incrementing (or schema migration path needs defining).
- [!] `childSessionIds` is defined as "not persisted, host-side projection" — `ProjectSessionManager` will need a new method to derive it (e.g., `getChildSessionIds(sessionId)`).
- [?] Whether `parentSessionId` should be nullable or required with a sentinel (e.g., `'__root__'`) — design doc says `null`, but implementation must handle `null` correctly everywhere.
- [?] Whether `stoa-ctl` design doc covers the exact schema version bump strategy for `PersistedSession`.

### Implementation Checklist (bounded)

1. Add `parentSessionId: string | null` and `createdBySessionId: string | null` to `SessionSummary` interface
2. Add `parent_session_id: string | null` and `created_by_session_id: string | null` to `PersistedSession` interface
3. Optionally add `parentSessionId?: string` to `CreateSessionRequest`
4. Update `toPersistedSession` mapper to copy both new fields
5. Update `toSessionSummary` mapper to read both new fields with fallback `?? null`
6. Update `createSession()` object literal to include `parentSessionId` and `createdBySessionId`
7. Update `src/shared/project-session.test.ts` session factory — add both fields as `null`
8. Update `src/shared/session-state-reducer.test.ts` session factory — add both fields as `null`
9. Add `SessionTreeMeta` and `SessionNodeSnapshot` types (host-side read model, not persisted)
10. Run `npm run test:generate && npx vitest run` — verify no regressions