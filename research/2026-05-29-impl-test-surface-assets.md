---
date: 2026-05-29
topic: impl-test-surface-assets
status: completed
mode: context-gathering
sources: 28
---

# Context Report: Implementation Test Surface Assets — Unified Session Tree

## Why This Was Gathered

The stoa-ctl unified session tree design (2026-05-29) mandates:
1. Removal of independent `meta-session` product concept
2. Introduction of explicit session tree via `parentSessionId` / `SessionNodeSnapshot`
3. Tree-structured renderer store and UI
4. `session:event` envelope-based push

This report identifies which testing assets (`testing/**/*`, `tests/generated/**/*`) must be updated, replaced, or created when the spec is implemented.

## Summary

Two behavior declarations, two topology specs, two journey declarations, and one generated Playwright spec are **hard-coupled** to the meta-session product concept and must be replaced entirely. One generator function and its test are hard-coded to meta-session surface interactions. The behavior-coverage test suite has five test cases importing meta-session assets and will need updates. Best insertion points for new session-tree coverage are identified.

## Key Findings

### Tier 1: Files that MUST be replaced (meta-session is the entity being tested)

| File | What Must Change | Lines |
|------|-----------------|-------|
| `testing/behavior/meta-session.behavior.ts` | Replace `metaSessionSurfaceSessionFlowBehavior` and `metaSessionReadFullContextAndGatePromptBehavior` with `session.tree.root` and `session.tree.child` tree-structure behaviors | 3–47 |
| `testing/behavior/meta-session.behavior.test.ts` | Replace all 5 test cases (lines 8–38) that verify meta-session-specific entities, actions, and assertions | 1–39 |
| `testing/topology/meta-session.topology.ts` | Replace `metaSessionTopology` with `sessionTreeTopology` that declares testIds for unified session tree rows (root vs child indentation) | 1–16 |
| `testing/topology/meta-session.topology.test.ts` | Replace all assertions (lines 5–16) to verify new tree surface testIds | 1–17 |
| `testing/journeys/meta-session.journey.ts` | Replace `metaSessionSurfaceSessionFlowJourney` and `metaSessionReadFullContextAndGatePromptJourney` with `session.tree.root.journey` and `session.tree.child.journey` | 1–27 |
| `testing/journeys/meta-session.journey.test.ts` | Replace all test cases verifying journey linkage to meta-session surface | 1–38 |
| `testing/generators/generate-playwright.ts` | Remove `generateMetaSessionSurfaceSessionFlowPlaywrightSkeleton()` (lines 318–357); add `generateSessionTreePlaywrightSkeleton()` for the new unified tree surface | 318–357 |
| `testing/generators/generate-playwright.test.ts` | Remove test at lines 90–103 (`generates a deterministic meta session surface session flow skeleton`); add test for new session tree skeleton | 90–103 |
| `tests/generated/playwright/meta-session-surface-session-flow.generated.spec.ts` | Delete entire file — auto-regenerated content from old spec | 1–37 |

### Tier 2: Files that need extension or repurposing

| File | What Needs Changing | Lines / Notes |
|------|--------------------|---------------|
| `testing/behavior/session.behavior.ts` | `entities` on lines 118–119 include `'runtime-state'`, `'turn-state'` which may need extension for tree context; `entities` on line 169 includes `'completion'` which is an old concept. `sessionPresenceCompleteBehavior` expects `session.lastTurnOutcome=completed` — verify this still holds after tree event envelope. Also: add new `session.tree.visibility` and `session.tree.authority` behaviors here | 114–233 |
| `testing/topology/command.topology.ts` | `sessionRow` testId on line 16 may need to serve as generic session tree row; consider adding child-session variant testId (`session-row.child`) | 16 |
| `testing/topology/provider.topology.ts` | Provider card testIds (lines 6–9) currently only used by meta-session surface. After meta-session removal, these become available for new session-tree "create child session" picker, but no change to file needed | 6–9 |
| `testing/journeys/session-telemetry.journey.ts` | Lines 7–8: `setup: ['project.withProviderSession', 'session.selectedInCommandSurface']` — after tree restructure, session selection context changes. `sessionTelemetryCompleteJourney` setup needs review against new tree broadcast model | 7–8 |
| `testing/generators/behavior-coverage.ts` | `classifyBehavior()` (lines 28–51) — logic is generic; will continue to work as long as new behavior contracts follow `BehaviorSpec` shape. No changes needed | 28–51 |
| `testing/generators/behavior-coverage.test.ts` | **5 test cases import meta-session assets**: lines 2–5 import `metaSession*` from `meta-session.behavior` and `meta-session.journey`; lines 14–21, 36–58, 60–83 all test meta-session coverage. These must be replaced with session-tree test cases | 2–5, 14–21, 36–83 |

### Tier 3: New assets to create (best insertion points)

#### New behavior declarations (add to `testing/behavior/`)

**`session-tree.behavior.ts`** (new file):
- `sessionTreeRootBehavior` — `actor: user`, `entities: ['session', 'session-tree', 'project']`, `action: session.createRoot`, `expects: ['session.tree.rootCreated', 'session.tree.activeRoot']`
- `sessionTreeChildBehavior` — `actor: user`, `entities: ['session', 'session-tree', 'parentSession']`, `action: session.createChild`, `expects: ['session.tree.childCreated', 'session.tree.parentExpanded', 'session.tree.childNotActive']`
- `sessionTreeDestroySubtreeBehavior` — `actor: user`, `entities: ['session', 'session-tree', 'subtree']`, `action: session.destroySubtree`, `expects: ['session.tree.subtreeArchived', 'session.tree.subtreeRestored']`
- `sessionTreeInspectChildBehavior` — `actor: session` (session caller context), `entities: ['session', 'visible-peer', 'descendant']`, `action: stoa-ctl.session.inspect`, `expects: ['ctl.context.returned', 'ctl.visibility.respected']`
- `sessionTreeAuthorityMatrixBehavior` — `actor: system`, `entities: ['session', 'authority-matrix']`, `action: visibility.derive`, `expects: ['session.visibility.sameDepthPlusDescendants']`

**`session-tree.behavior.test.ts`** (new file):
- Tests for each new behavior following the pattern in `meta-session.behavior.test.ts` lines 8–38

#### New topology (add to `testing/topology/`)

**`session-tree.topology.ts`** (new file):
```ts
export const sessionTreeTopology = defineTopology({
  surface: 'session-tree',
  testIds: {
    root: 'workspace-hierarchy-panel',
    rootSessionRow: 'session-row.root',
    childSessionRow: 'session-row.child',
    childIndent: 'session-row.indent',
    childCountBadge: 'session-row.child-count',
    treeExpandToggle: 'session-row.expand-toggle',
    createChildButton: 'session.create-child',
    destroyButton: 'session.destroy',
    promptButton: 'session.prompt'
  }
})
```

**`session-tree.topology.test.ts`** (new file):
- Tests for each testId following the pattern in `meta-session.topology.test.ts`

#### New journey (add to `testing/journeys/`)

**`session-tree.journey.ts`** (new file):
```ts
export const sessionTreeRootJourney = defineJourney({
  id: 'journey.session.tree.root',
  behavior: 'session.tree.root',
  setup: ['project.exists'],
  act: ['click.workspace.newSession', 'select.provider', 'assert.sessionTreeVisible'],
  assert: ['session.tree.rootCreated', 'command.sessionActive'],
  variants: ['single-tree']
})

export const sessionTreeChildJourney = defineJourney({
  id: 'journey.session.tree.child',
  behavior: 'session.tree.child',
  setup: ['project.withRootSession', 'session.selected'],
  act: ['click.session.createChild', 'select.provider'],
  assert: ['session.tree.childCreated', 'session.tree.parentExpanded', 'session.tree.childNotActive'],
  variants: ['user-created', 'session-created']
})
```

**`session-tree.journey.test.ts`** (new file):
- Tests linking journeys to behaviors following `meta-session.journey.test.ts` pattern

#### New generator (add to `testing/generators/generate-playwright.ts`)

**`generateSessionTreePlaywrightSkeleton()`** (new function):
- Replaces `generateMetaSessionSurfaceSessionFlowPlaywrightSkeleton()`
- Generates Playwright test that clicks unified workspace hierarchy → creates root session → creates child session → verifies tree structure and non-stealing of active session
- Imports from `sessionTreeTopology`, `sessionTreeRootJourney`, `sessionTreeChildJourney`, `sessionTreeChildBehavior`

#### Generated spec (auto-regenerated after generator update)

After updating `testing/generators/generate-playwright.ts` and running `npm run test:generate`:
- Delete `tests/generated/playwright/meta-session-surface-session-flow.generated.spec.ts`
- Regenerate `tests/generated/playwright/session-tree-root.generated.spec.ts`
- Regenerate `tests/generated/playwright/session-tree-child.generated.spec.ts`

### Tier 4: Session telemetry and presence — minimal changes needed

The presence behaviors (`session.behavior.ts` lines 114–233) and session telemetry journeys (`session-telemetry.journey.ts`) model the **runtime lifecycle** of individual sessions, which remains largely valid under the new design. Changes needed:

- `session.behavior.ts` line 169: `'completion'` entity — verify if this refers to meta-session proposal/completion concept or generic session completion. If meta-session-specific, rename to `'turn-completion'`
- `session.behavior.ts` line 181: `user.visitsCompletedSession` — the "visit" semantics for completing a session are still valid under tree design, no change needed
- `session.behavior.ts` line 182: `runtime.exitedFailed.afterCompletion` — still valid
- `session.behavior.ts` line 227: `session.runtimeExitReason=failed_to_start OR session.runtimeExitReason=failed` — check if `failed_to_start` string value is still correct under new session supervisor

The generated Playwright spec at `tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts` uses `postWebhookEvent` with `event_type: 'runtime.exited_failed'` — this aligns with the new `SessionGraphEvent` envelope design and needs no change.

### Tier 5: Contracts and generators — no changes needed

| File | Assessment | Reason |
|------|-----------|--------|
| `testing/contracts/testing-contracts.ts` | No changes needed | DSL is entity/behavior agnostic; `defineBehavior`/`defineJourney`/`defineTopology`/`defineGeneratedTestMeta` all remain valid for new assets |
| `testing/contracts/testing-contracts.test.ts` | No changes needed | Tests the DSL itself, not the entity model |
| `testing/generators/behavior-coverage.ts` | No changes needed | Logic is generic; `classifyBehavior` works on any `BehaviorSpec[]` + `JourneySpec[]` + `GeneratedTestMeta[]` |
| `testing/generators/write-generated-playwright.ts` | No changes needed | Writes files from generator output; will work if generator is updated |

### Tier 6: Other topology files — no changes needed (review complete)

| File | Assessment |
|------|-----------|
| `testing/topology/activity-bar.topology.ts` | No changes needed |
| `testing/topology/archive.topology.ts` | No changes needed |
| `testing/topology/command.topology.ts` | No changes needed — `sessionRow` testId at line 16 is generic |
| `testing/topology/memory-notification.topology.ts` | No changes needed |
| `testing/topology/modal.topology.ts` | No changes needed |
| `testing/topology/provider.topology.ts` | No changes needed |
| `testing/topology/session-status.topology.ts` | No changes needed |
| `testing/topology/terminal.topology.ts` | No changes needed |
| `testing/topology/archive.topology.test.ts` | No changes needed |
| `testing/topology/memory-notification.topology.test.ts` | No changes needed |
| `testing/topology/session-status.topology.test.ts` | No changes needed |
| `testing/topology/terminal.topology.test.ts` | No changes needed |

## Evidence Chain

| Finding | Source | Location |
|--------|--------|----------|
| `meta-session.behavior.ts` defines 2 behaviors with `meta-session` entities and actions | `testing/behavior/meta-session.behavior.ts` | lines 3–47 |
| `meta-session.behavior.test.ts` imports and tests those behaviors | `testing/behavior/meta-session.behavior.test.ts` | lines 2–5, 8–38 |
| `metaSessionTopology` defines surface `'meta-session'` with testIds for surface/terminal-deck/inspector | `testing/topology/meta-session.topology.ts` | lines 3–15 |
| `metaSessionTopology` test assertions | `testing/topology/meta-session.topology.test.ts` | lines 5–16 |
| `metaSessionSurfaceSessionFlowJourney` and `metaSessionReadFullContextAndGatePromptJourney` | `testing/journeys/meta-session.journey.ts` | lines 3–27 |
| Journey test assertions linking to meta-session surface | `testing/journeys/meta-session.journey.test.ts` | lines 9–37 |
| `generateMetaSessionSurfaceSessionFlowPlaywrightSkeleton()` hard-codes meta-session surface testIds | `testing/generators/generate-playwright.ts` | lines 318–357 |
| Generator test for meta-session skeleton | `testing/generators/generate-playwright.test.ts` | lines 90–103 |
| Generated Playwright spec for meta-session surface | `tests/generated/playwright/meta-session-surface-session-flow.generated.spec.ts` | lines 1–37 |
| `behavior-coverage.test.ts` imports 5 meta-session assets | `testing/generators/behavior-coverage.test.ts` | lines 2–5, 14–21, 36–83 |
| `session.behavior.ts` `entities` include `'turn-state'` and `'completion'` | `testing/behavior/session.behavior.ts` | lines 118–119, 169 |
| `session.behavior.ts` presence behaviors model individual session lifecycle (unchanged) | `testing/behavior/session.behavior.ts` | lines 114–233 |
| `testing-contracts.ts` DSL functions are entity-agnostic | `testing/contracts/testing-contracts.ts` | lines 65–164 |
| `classifyBehavior()` is generic coverage logic | `testing/generators/behavior-coverage.ts` | lines 28–51 |
| `generatePlaywrightSkeleton()` uses topology testIds from `archive.topology.ts` (generic) | `testing/generators/generate-playwright.ts` | lines 9–14 |
| `generateClaudeLifecyclePlaywrightSkeleton()` uses event envelope `event_type: 'runtime.exited_failed'` | `testing/generators/generate-playwright.ts` | lines 229–243 |
| Session telemetry journeys use `['project.withProviderSession', 'session.selectedInCommandSurface']` | `testing/journeys/session-telemetry.journey.ts` | lines 7–8 |
| Stoa-ctl unified session tree spec mandates meta-session removal and session tree introduction | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 16–20, 36–46, 337–369 |
| `session:event` must become unified upsert envelope covering create/update/archive/restore/destroy | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 696–723 |
| Tree projection must change from `Project -> Sessions` to `Project -> Root Sessions -> Child Sessions` | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 744–756 |
| Child session background creation must not steal active session | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 758–771 |

## Risks / Unknowns

- **[!]** `session.behavior.ts` line 169 `'completion'` entity: unclear if this refers to the old meta-session proposal/completion flow or generic session completion. Needs clarification before updating.
- **[!]** `session.behavior.ts` line 227 `session.runtimeExitReason=failed_to_start` string: must verify this literal value matches the actual state value under new `SessionSupervisor`.
- **[?]** After meta-session removal, do `session:create-child`, `session:prompt`, `session:destroy` IPC channels need their own topology declarations, or does `command.topology.ts` serve as the single surface topology?
- **[?]** The spec says `session:event` replaces `session:create` as the primary broadcast mechanism. Does this mean the existing `session-restore.journey` and its generated spec need updates for the new event envelope?
- **[?]** Should `testing/topology/provider.topology.ts` be renamed or kept as-is? It currently serves the meta-session session-create picker but could serve the new unified tree child-session picker.
- **[?]** The spec's `SessionGraphEvent` envelope has `kind: 'destroyed'`. Does the existing `session.restore.journey` need a corresponding `session.tree.destroySubtree.journey`?

## Implementation Order (Test Surface)

Based on the spec's implementation order (sections 906–915), test surface updates should follow:

1. **Before step 6** (delete meta-session store/IPC/UI): Replace all meta-session assets in `testing/behavior/`, `testing/topology/`, `testing/journeys/`, `testing/generators/`
2. **Before step 7** (renderer store tree projection + upsert): Add `session-tree.topology.ts` and `session-tree.topology.test.ts`
3. **Before step 7**: Add `session-tree.behavior.ts`, `session-tree.behavior.test.ts`, `session-tree.journey.ts`, `session-tree.journey.test.ts`
4. **Before step 8** (WorkspaceHierarchyPanel + terminal deck): Add `generateSessionTreePlaywrightSkeleton()` and its test
5. **After step 9** (补齐 unit/IPC/renderer/e2e/behavior coverage): Regenerate all generated Playwright specs; verify behavior coverage maturity levels

## File Summary Table

| File | Action |
|------|--------|
| `testing/behavior/meta-session.behavior.ts` | **DELETE** and replace with `session-tree.behavior.ts` |
| `testing/behavior/meta-session.behavior.test.ts` | **DELETE** and replace with `session-tree.behavior.test.ts` |
| `testing/topology/meta-session.topology.ts` | **DELETE** and replace with `session-tree.topology.ts` |
| `testing/topology/meta-session.topology.test.ts` | **DELETE** and replace with `session-tree.topology.test.ts` |
| `testing/journeys/meta-session.journey.ts` | **DELETE** and replace with `session-tree.journey.ts` |
| `testing/journeys/meta-session.journey.test.ts` | **DELETE** and replace with `session-tree.journey.test.ts` |
| `testing/generators/generate-playwright.ts` | **REMOVE lines 318–357**, add `generateSessionTreePlaywrightSkeleton()` |
| `testing/generators/generate-playwright.test.ts` | **REMOVE lines 90–103**, add session tree skeleton test |
| `testing/generators/behavior-coverage.test.ts` | **UPDATE lines 2–5, 14–21, 36–83** with session tree assets |
| `tests/generated/playwright/meta-session-surface-session-flow.generated.spec.ts` | **DELETE** (auto-regenerated) |
| `testing/behavior/session.behavior.ts` | **REVIEW/RENAME** `completion` entity; verify presence behavior entity strings |
| `testing/topology/command.topology.ts` | **EXTEND** with `session-row.child` testId |
| `testing/contracts/testing-contracts.ts` | No changes |
| `testing/contracts/testing-contracts.test.ts` | No changes |
| `testing/generators/behavior-coverage.ts` | No changes |
| `testing/generators/behavior-coverage.test.ts` | Only asset imports change (see above) |
| `testing/generators/write-generated-playwright.ts` | No changes |
| All other `testing/topology/*.ts` and `*.test.ts` | No changes |
| All other `testing/journeys/*.ts` and `*.test.ts` | No changes |
| `tests/generated/playwright/session-restore.generated.spec.ts` | No changes |
| `tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts` | No changes |
| `tests/generated/playwright/workspace-quick-access.generated.spec.ts` | No changes |