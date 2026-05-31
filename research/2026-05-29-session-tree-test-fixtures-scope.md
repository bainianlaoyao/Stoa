---
date: 2026-05-29
topic: session-tree-test-fixtures-scope
status: completed
mode: context-gathering
sources: 16
---

## Context Report: Session Tree Test Fixture Scope

### Why This Was Gathered
Bounded code search to determine which test files instantiate `SessionSummary` fixtures that will need `parentSessionId` / `createdBySessionId` fields added once the unified session tree control plane lands.

### Summary
The design spec defines two new fields for `SessionSummary` (`parentSessionId`, `createdBySessionId`), but these fields do not yet exist in the production `SessionSummary` interface. All 14 test files that create `SessionSummary` fixtures are missing these fields — not because the fixtures are incomplete, but because the fields don't exist yet. Once the interface is extended, all fixture factories across the test suite will need to add `parentSessionId: null` and `createdBySessionId: null` to their base objects.

### Key Findings

1. **Design spec defines new fields** — `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` (line 147-148) specifies `parentSessionId: string | null` (authority hierarchy) and `createdBySessionId: string | null` (audit trail, not used for visibility/tree projection) for `SessionSummary`.

2. **Interface not yet updated** — `src/shared/project-session.ts:122-145` is the current `SessionSummary` interface with 15 fields; neither `parentSessionId` nor `createdBySessionId` exists there yet.

3. **All fixtures missing both fields** — Grep for `parentSessionId` / `createdBySessionId` across the entire codebase returns zero matches. No production or test code references these fields because they haven't been added to the interface yet.

4. **14 test files in scope** — All files that create `SessionSummary` objects will need `parentSessionId: null` and `createdBySessionId: null` added to fixture factories once the interface is extended.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| New fields defined in spec | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 147-148, 154-156 |
| `SessionSummary` current interface | `src/shared/project-session.ts` | lines 122-145 |
| `parentSessionId` / `createdBySessionId` not in codebase | Grep across `src/**/*.ts` | zero matches |
| Fixture factory pattern | `src/renderer/app/App.test.ts` | line 43 (`createSessionSummary`) |
| Fixture factory pattern | `src/renderer/stores/observability-view-models.test.ts` | line 23 (`sessionFixture`) |
| Fixture factory pattern | `src/renderer/stores/workspaces.test.ts` | line 232 (`sessionSummaryFixture`) |
| Inline fixture object | `src/renderer/components/AppShell.test.ts` | line 25 (`baseSession`) |
| Inline fixture object | `src/renderer/components/PanelExtensions.test.ts` | line 25 (`mockSession`) |
| Inline fixture objects | `src/renderer/components/command/CommandSurface.test.ts` | lines 92, 117, 142 (`activeSession`, `secondAiSession`, `shellSession`) |
| Inline fixture object | `src/renderer/components/TerminalViewport.test.ts` | line 163 (`baseSession`) |
| Fixture factory | `src/renderer/components/TerminalViewport.test.ts` | line 193 (`sessionSummary`) |
| Fixture factory | `src/renderer/components/command/TerminalSessionDeck.test.ts` | line 66 (`sessionFixture`) |
| Inline fixture object | `src/renderer/components/command/WorkspaceQuickActions.test.ts` | line 20 |
| Fixture factory | `src/shared/observability-projection.test.ts` | line 25 (`sessionFixture`) |
| Fixture factory | `src/shared/session-state-reducer.test.ts` | line 22 (`session`) |
| Inline fixture object | `src/shared/project-session.test.ts` | line 22 |

### Scope of Fixture Edits (14 files)

Once `parentSessionId` and `createdBySessionId` are added to `SessionSummary`:

| File | Fixture Pattern | Lines |
|------|----------------|-------|
| `src/renderer/app/App.test.ts` | `createSessionSummary()` factory | 43-69 |
| `src/renderer/stores/observability-view-models.test.ts` | `sessionFixture()` factory | 23-49 |
| `src/renderer/stores/workspaces.test.ts` | `sessionSummaryFixture()` factory | 232-257 |
| `src/renderer/components/AppShell.test.ts` | Inline `baseSession` object | 25-48 |
| `src/renderer/components/PanelExtensions.test.ts` | Inline `mockSession` object | 25-53 |
| `src/renderer/components/command/CommandSurface.test.ts` | Inline `activeSession`, `secondAiSession`, `shellSession` | 92-159 |
| `src/renderer/components/TerminalViewport.test.ts` | Inline `baseSession` + `sessionSummary()` factory | 163-198 |
| `src/renderer/components/command/TerminalSessionDeck.test.ts` | `sessionFixture()` factory | 66-92 |
| `src/renderer/components/command/WorkspaceQuickActions.test.ts` | Inline `session` object | 20-48 |
| `src/shared/observability-projection.test.ts` | `sessionFixture()` factory | 25-51 |
| `src/shared/session-state-reducer.test.ts` | `session()` factory | 22-48 |
| `src/shared/project-session.test.ts` | Inline `session` object | 22-50 |

### Risks / Unknowns

- [!] `src/shared/project-session.ts` interface must be extended before any fixture edits can land — fixture cleanup is gated on the production type change.
- [?] `PersistedSession` interface (`src/shared/project-session.ts:163-186`) may also need `parent_session_id` / `created_by_session_id` fields for JSON persistence. Not confirmed — depends on whether the session tree is serialized.
- [?] Whether fixture helpers like `createTitleGenerationContext()` in `src/renderer/app/App.test.ts:30` need `parentSessionId` passed through from callers.

---

## Context Handoff: Session Tree Test Fixture Scope

Start here: `research/2026-05-29-session-tree-test-fixtures-scope.md`

Context only. Use the saved report as the source of truth.