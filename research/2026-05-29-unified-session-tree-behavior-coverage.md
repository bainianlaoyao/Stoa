---
date: 2026-05-29
topic: unified-session-tree-and-subagent-session-behavior-coverage
status: completed
mode: context-gathering
sources: 27
---

## Context Report: Unified Session Tree and Subagent Session Control Behavior Coverage

### Why This Was Gathered
Identify existing behavior/topology/journey/generated coverage for unified session tree and child/subagent session control, and identify missing assets or stale meta-session assets leaving coverage gaps.

### Summary
No behavior, topology, journey, or generated test assets exist for "unified session tree" or "subagent/child session control" concepts. The meta-session testing assets reference deleted Vue files (MetaSessionSurface.vue, etc.), making them stale. Critical behaviors declared in `testing/behavior/meta-session.behavior.ts` have observation layer mismatches between declaration and generated test coverage.

### Key Findings

#### 1. No unified session tree coverage exists

All testing assets focus on:
- Terminal sessions (shell, claude-code, codex)
- Session presence lifecycle (ready, running, blocked, complete, failure)
- Session restore/archive
- Session telemetry (claude hook events)

No behavior, journey, topology, or generated test references:
- "unified session tree"
- "child session"
- "subagent session"
- "parent session"
- Session hierarchy (nested sessions)

Evidence: `testing/behavior/` (2 files), `testing/journeys/` (5 files), `testing/topology/` (13 files) — Grep for `subagent|child.?session|unified.?session` returns zero matches.

#### 2. Meta-session behavior assets are stale

`testing/behavior/meta-session.behavior.ts` declares 2 behaviors that reference files deleted from the codebase:

| Behavior | Referenced testIds | Status |
|----------|-------------------|--------|
| `meta-session.surface.session-flow` | `surface.meta-session`, `meta-session-session-list`, `meta-session.session.create`, `meta-session.session.item`, `provider-card`, `provider-card.item`, `meta-session-terminal-deck`, `meta-session-inspector-panel`, `meta-session-action-panel` | Files deleted |
| `meta-session.read-full-context-and-gate-prompt` | (context/approval logic) | No generated test exists |

Sources:
- `testing/behavior/meta-session.behavior.ts:1-47`
- `testing/topology/meta-session.topology.ts:1-16` — defines topology for deleted files
- Deleted files (from git status): `MetaSessionSurface.vue`, `MetaSessionTerminalDeck.vue`, `MetaSessionInspectorPanel.vue`, `MetaSessionActionPanel.vue`, `MetaSessionSessionList.vue`

#### 3. Meta-session behaviors have observation layer mismatches

`metaSessionSurfaceSessionFlowBehavior` declares observationLayers as `['ui', 'renderer-store']` (line 22).

The generated test `meta-session-surface-session-flow.generated.spec.ts` declares the same (line 11).

**However**, `metaSessionReadFullContextAndGatePromptBehavior` declares observationLayers as `['main-debug-state', 'persisted-state']` (line 44) but NO generated test covers this behavior. The only generated meta-session test (`meta-session-surface-session-flow.generated.spec.ts`) covers `['ui', 'renderer-store']`, not the context-gating behavior's declared layers.

Source: `testing/behavior/meta-session.behavior.ts:27-47`, `tests/generated/playwright/meta-session-surface-session-flow.generated.spec.ts:1-37`

#### 4. Coverage maturity classification reveals gaps

The `classifyBehavior` function in `testing/generators/behavior-coverage.ts:28-51` requires for "Hardened" (critical budget):
- All observation layers covered
- At least one interruption covered

| Behavior | Budget | Maturity | Missing Interruptions |
|----------|--------|----------|----------------------|
| `meta-session.surface.session-flow` | high | Verified | `meta-session.runtime.failedToStart` not covered |
| `meta-session.read-full-context-and-gate-prompt` | critical | Declared (no generated test) | `proposal.dispatch.afterStaleContext`, `app.relaunch.duringPromptGate` |
| `session.telemetry.complete` | critical | Hardened (existing) | `app.relaunch.duringTelemetry` |
| `session.telemetry.blocked` | critical | Hardened (existing) | `app.relaunch.duringTelemetry` |
| `session.presence.complete` | critical | Verified | interrupts not covered |
| `session.presence.blocked` | critical | Verified | `provider.permissionResolved`, `runtime.exitedFailed.whileBlocked` not covered |
| `session.presence.failure` | critical | Verified | `runtime.exitedFailed.afterCompletion`, `runtime.exitedFailed.whileBlocked` not covered |

Source: `testing/generators/behavior-coverage.test.ts:60-83, 175-198, 200-223, 288-328`

#### 5. Journey-to-generated test mapping is incomplete

| Journey | Generated Test | Status |
|---------|---------------|--------|
| `journey.meta-session.surface.session-flow` | `meta-session-surface-session-flow.generated.spec.ts` | Exists |
| `journey.meta-session.read-full-context-and-gate-prompt` | None | **Missing** |
| `journey.session.restore.base` | `session-restore.generated.spec.ts` | Exists |
| `journey.workspace.quick-access.actions` | `workspace-quick-access.generated.spec.ts` | Exists |
| `journey.session.telemetry.claude-lifecycle` | `session-telemetry-claude-lifecycle.generated.spec.ts` | Exists |
| `journey.session.memory-notification` | None | **Missing** |
| `journey.session.telemetry.complete` | None | **Missing** |
| `journey.session.telemetry.blocked` | None | **Missing** |
| `journey.session.presence.ready` | None | **Missing** |
| `journey.session.presence.running` | None | **Missing** |
| `journey.session.presence.blocked` | None | **Missing** |
| `journey.session.presence.failure` | None | **Missing** |
| `journey.session.presence.ready-after-interrupt` | None | **Missing** |

Source: `testing/journeys/*.ts` vs `tests/generated/playwright/*.generated.spec.ts`

#### 6. Generator outputs have file naming inconsistencies

The generated test file `session-restore.generated.spec.ts` uses `archive.session.restore` and `archive.session.row` testIds (matching `archiveTopology`), but the skeleton generator (`generate-playwright.ts:12-13`) hardcodes `restoreButtonTestId = topology.testIds.restoreButton` and `sessionRowTestId = topology.testIds.sessionRow` — this is correct, but the generator skeleton is tightly coupled to specific topology structures.

Source: `testing/generators/generate-playwright.ts:9-65`, `testing/topology/archive.topology.ts:1-10`

### Risks / Unknowns

- [!] **Stale meta-session topology** — `testing/topology/meta-session.topology.ts` defines testIds for deleted Vue components. Running behavior coverage checks will fail because rendered elements won't exist.
- [!] **Missing critical behavior coverage** — `meta-session.read-full-context-and-gate-prompt` is declared `critical` but has no generated test, making it `Declared` maturity.
- [!] **Missing interruption coverage for critical behaviors** — Several critical behaviors (complete, blocked, failure presence) lack interruption testing for app.relaunch scenarios.
- [?] **Unified session tree concept** — No existing assets define what "unified session tree" means in behavioral terms. The git branch `feature/unified-session-tree` suggests new functionality, but testing assets predate it.
- [?] **Subagent/child session control** — No behaviors define parent-child session relationships, session delegation, or subagent spawning.

### Coverage Gap Summary

| Category | Count | Details |
|----------|-------|---------|
| Stale topology files | 1 | `testing/topology/meta-session.topology.ts` (references deleted files) |
| Stale behavior files | 1 | `testing/behavior/meta-session.behavior.ts` (partially stale) |
| Missing generated tests for declared journeys | 10 | Memory notification, telemetry complete/blocked, all presence states, read-full-context |
| Missing interruption coverage | 4 | App relaunch scenarios for critical behaviors |
| No unified-session-tree assets | N/A | Entire concept missing from testing layer |
| No subagent/child session assets | N/A | No parent-child session relationship behaviors |

---

## Context Handoff: Unified Session Tree and Subagent Session Control Behavior Coverage

Start here: `D:/Data/DEV/ultra_simple_panel/.worktrees/unified-session-tree/research/2026-05-29-unified-session-tree-behavior-coverage.md`

Context only. Use the saved report as the source of truth.