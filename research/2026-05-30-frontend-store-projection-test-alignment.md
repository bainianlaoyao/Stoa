---
date: 2026-05-30
topic: frontend-store-projection test alignment with unified session tree
status: completed
mode: context-gathering
sources: 6
---

## Context Report: frontend-store-projection.test.ts — Obsolete Meta-Session Coverage vs Unified Session Tree

### Why This Was Gathered

The `src/renderer/stores/meta-session.ts` store has been deleted from the working tree on the `feature/unified-session-tree` branch. The E2E test suite `tests/e2e/frontend-store-projection.test.ts` still imports and tests that deleted store. This report identifies exactly what must be removed and what minimal edits align the suite with the current store contract.

### Summary

The test file contains a full `describe('Meta session surface store projection')` block (lines 84–177) that imports and exercises the now-deleted `useMetaSessionStore`. This entire block and its associated imports must be removed. The remaining workspace store tests (Phases 1–8) are structurally valid — the workspace store's `hydrate`/computed contract is backward-compatible for flat session hierarchies — but the `createRendererApiWithPresence` helper is missing many `RendererApi` methods added since it was written, which will cause TypeScript compilation errors when the file is type-checked.

### Key Findings

#### F1. The meta-session store has been deleted from the working tree

- `src/renderer/stores/meta-session.ts` — unstaged deletion on the current branch
- Last commit touching it: `bb6fd24 feat(meta-session): finalize archive and restore flow`
- The store exported `useMetaSessionStore` which the test file imports at line 4

| Source | Location |
|--------|----------|
| Deleted store file | `src/renderer/stores/meta-session.ts` (git: deleted, unstaged) |
| Test import | `tests/e2e/frontend-store-projection.test.ts:4` |

#### F2. Two test cases depend exclusively on the deleted store

- **Line 85**: `"meta session store hydrates independently from work-session hierarchy"` — calls `useMetaSessionStore()` and `store.hydrate(bootstrap)`
- **Line 117**: `"meta session proposal hydration updates pending counts and selected proposal projection independently from work-session hierarchy"` — calls `useMetaSessionStore()`, `store.hydrate(bootstrap)`, and `store.hydrateProposals(proposals)`

Both tests exercise `MetaSessionBootstrapState`, `MetaSessionProposal`, `MetaSessionSummary` types which still exist at `src/shared/meta-session.ts` but have no renderer store consumer anymore.

| Source | Location |
|--------|----------|
| Test case 1 | `tests/e2e/frontend-store-projection.test.ts:85-115` |
| Test case 2 | `tests/e2e/frontend-store-projection.test.ts:117-176` |
| Describe block wrapper | `tests/e2e/frontend-store-projection.test.ts:84-177` |
| Meta-session types (still exist) | `src/shared/meta-session.ts` |

#### F3. Three imports are used only by the removed tests

- Line 4: `import { useMetaSessionStore } from '@renderer/stores/meta-session'` — **entire import line must be deleted**
- Line 10: `import type { MetaSessionBootstrapState, MetaSessionProposal, MetaSessionSummary } from '@shared/meta-session'` — **entire import line must be deleted** (no other consumer in this file)
- Line 8: `import type { ... SessionSummary } from '@shared/project-session'` — `SessionSummary` is still used by Phase 4+ tests, so this stays

| Source | Location |
|--------|----------|
| Store import | `tests/e2e/frontend-store-projection.test.ts:4` |
| Meta-session type import | `tests/e2e/frontend-store-projection.test.ts:10` |

#### F4. `createRendererApiWithPresence` helper is missing ~25 RendererApi methods

The helper (lines 27–73) creates a partial `RendererApi` mock. The current `RendererApi` interface at `src/shared/project-session.ts:356-452` now requires:

**Required methods missing from the helper:**
- `windowsBuildNumber` (property)
- `deleteProject`
- `openWorkspace`
- `regenerateSessionTitle`
- `onSessionEvent`
- `onSessionGraphEvent` (optional but should be present)
- `titleGenerationFetchModels`
- `detectVscode`
- `restartSession`
- `uninstallSidecars`
- `listSessionEvidence`
- `contextExportFullText`
- `contextExportSlimText`
- `onTitleGenerationNotification`
- `getSidebarState` / `setSidebarState`
- `fsReadDir`, `fsReadFile`, `fsWriteFile`, `fsCreate`, `fsRename`, `fsDelete`, `fsSearch`, `onFsChanged`
- `gitStatus`, `gitStage`, `gitUnstage`, `gitDiscard`, `gitCommit`, `gitPush`, `gitPull`, `gitFetch`, `gitRebase`, `gitMerge`, `gitBranches`, `gitLog`, `gitDiff`, `gitCheckout`, `gitCreateBranch`

**Note:** The helper is used only in Phase 8 tests (lines 1011, 1058) via `window.stoa = createRendererApiWithPresence(...)`. Whether TS complains depends on how `window.stoa` is typed. The helper returns an untyped object literal, so it will compile — but it's fragile and will break if any Phase 8 test calls a missing method.

| Source | Location |
|--------|----------|
| Helper definition | `tests/e2e/frontend-store-projection.test.ts:27-73` |
| RendererApi interface | `src/shared/project-session.ts:356-452` |
| Usage in Phase 8 | `tests/e2e/frontend-store-projection.test.ts:1011,1058` |

#### F5. Remaining workspace store tests (Phases 1–8) are structurally valid

The `useWorkspaceStore` (at `src/renderer/stores/workspaces.ts`) now has session tree projection via `projectSessionsIntoTree`, `archivedSessions` in hierarchy nodes, and new actions (`removeProject`, `archiveSession`, `restoreSession`, `applySessionGraphEvent`). However:

- The `hydrate(state: BootstrapState)` signature is unchanged — all Phase 1–8 tests hydrate via `manager.snapshot()` which returns `BootstrapState`
- `projectHierarchy` computed now includes `archivedSessions` field — existing tests check only `.sessions`, so they pass
- Session tree projection only activates when sessions have `parentSessionId` pointing to an existing session — the test sessions are all flat, so they project identically to before
- No existing test exercises `removeProject`, `archiveSession`, `restoreSession`, `applySessionGraphEvent`, or tree hierarchy features, but those are **coverage gaps**, not **broken tests**

| Source | Location |
|--------|----------|
| Workspace store | `src/renderer/stores/workspaces.ts:167-553` |
| `projectSessionsIntoTree` | `src/renderer/stores/workspaces.ts:62-165` |
| Phase 1–8 tests | `tests/e2e/frontend-store-projection.test.ts:179-1068` |

### Risks / Unknowns

- **[!] Compile failure**: If the test file is type-checked (e.g. via `npm run typecheck`) before the meta-session import is removed, it will fail because `@renderer/stores/meta-session` no longer exists on disk
- **[!] RendererApi drift**: The helper mock is ~25 methods behind the current `RendererApi`. Phase 8 tests only call `getSessionPresence` and `onSessionPresenceChanged`, so they won't fail at runtime — but adding any new Phase 8 test that calls a missing method will silently return `undefined` instead of throwing
- **[?] Coverage gap priority**: The report identifies that tree projection, `archivedSessions`, `removeProject`, `archiveSession`/`restoreSession`, `applySessionGraphEvent` are untested in this file — whether these gaps should be filled is a separate task, not part of the "minimal edits" scope

### Minimal Edit Plan

1. **Delete** import at line 4: `import { useMetaSessionStore } from '@renderer/stores/meta-session'`
2. **Delete** import at line 10: `import type { MetaSessionBootstrapState, MetaSessionProposal, MetaSessionSummary } from '@shared/meta-session'`
3. **Delete** lines 84–177: the entire `describe('Meta session surface store projection', ...)` block
4. **(Optional but recommended)** Add missing stubs to `createRendererApiWithPresence` to satisfy the current `RendererApi` contract and prevent future drift
