---
date: 2026-05-29
topic: impl-test-surface
status: completed
mode: context-gathering
sources: 17
---

## Context Report: Unified Session Tree Implementation Test Surface

### Why This Was Gathered

Bounded implementation research for the test surface affected by the unified session tree design in `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`.

### Summary

The spec deletes the standalone meta-session product layer and replaces it with a unified session tree, `SessionNodeSnapshot` read model, session-scoped control auth, and a `SessionGraphEvent` push envelope. Any test that asserts `meta-session:*` IPC, `meta-session.json`, proposal/dispatch flows, old `stoa-ctl` commands, or flat session projection will break or need rewrite. The main rewrite clusters are `src/core/meta-session-*.test.ts`, `tests/e2e/ipc-bridge.test.ts`, `tests/e2e/main-config-guard.test.ts`, `tests/e2e/frontend-store-projection.test.ts`, `tools/stoa-ctl/index.test.ts`, and the meta-session behavior/topology/journey/generated assets.

### Key Findings

#### 1. Tests that will definitely break or need rewrite

Full rewrite or deletion:

- `src/core/meta-session-manager.test.ts` — asserts separate meta-session lifecycle, `activeMetaSessionId`, and bootstrap recovery behavior that the spec removes (`src/core/meta-session-manager.test.ts:23-171`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:337-369,541-566`).
- `src/core/meta-session-state-store.test.ts` — asserts `~/.stoa/meta-session.json`, `PersistedMetaSessionStateV1`, and legacy normalization that the spec deletes (`src/core/meta-session-state-store.test.ts:28-458`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:658-663`).
- `src/core/meta-session-control-server.test.ts` — old `/ctl/meta-sessions`, `/ctl/proposals`, bootstrap prompt, and ctl-secret auth all change under unified control routes (`src/core/meta-session-control-server.test.ts:158-1077`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:377-411,555-639`).
- `src/core/meta-session-command-dispatcher.test.ts` — proposal-gated prompt flow is explicitly removed (`src/core/meta-session-command-dispatcher.test.ts:12-385`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:487-540`).
- `src/core/meta-session-command-env.test.ts` — `STOA_META_SESSION*` env contract is replaced by session-scoped env vars (`src/core/meta-session-command-env.test.ts:5-23`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:397-411,623-633`).
- `src/core/meta-session-context-assembler.test.ts` — old meta-session bootstrap/context source no longer matches the read model (`src/core/meta-session-context-assembler.test.ts:107-162`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:635-657,729-756`).
- `src/core/meta-session-proposal-store.test.ts` — proposal entity and lifecycle are removed (`src/core/meta-session-proposal-store.test.ts:4-50`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:487-540`).
- `src/core/meta-session-provider-patch.test.ts` — old meta-session provider patching becomes irrelevant with unified session persistence (`src/core/meta-session-provider-patch.test.ts:37-84`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:337-369`).
- `tests/e2e/ipc-bridge.test.ts` — hard-codes 10 `meta-session:*` invoke channels, old preload methods, and old handler graph (`tests/e2e/ipc-bridge.test.ts:63-90,177-189,216-298,538-663`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:697-716,826-833`).
- `tests/e2e/main-config-guard.test.ts` — static analysis currently guards deleted meta-session imports, methods, and channel names (`tests/e2e/main-config-guard.test.ts:193-241,266-276,418-429,530-541,594-596`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:555-639,826-833`).
- `tests/e2e/frontend-store-projection.test.ts` — imports `useMetaSessionStore` and asserts old bootstrap/store shape instead of tree projection (`tests/e2e/frontend-store-projection.test.ts:84-177`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:729-771`).
- `tools/stoa-ctl/index.test.ts` — entire CLI surface targets deleted `meta-sessions`, `proposals`, `dispatch`, and `work-sessions` contracts (`tools/stoa-ctl/index.test.ts:19-22,29-51,81-107,109-176,178-382,412-609,663-843`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:377-411`).

Targeted rewrite or fixture/schema updates:

- `src/shared/project-session.test.ts` — `SessionSummary`/`PersistedSession` fixtures need `parentSessionId`, `createdBySessionId`, and persisted field updates (`src/shared/project-session.test.ts:22-125`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:145-159`).
- `src/core/project-session-manager.test.ts` — persistence assertions and `createSession` fixtures need tree fields and schema-version bump coverage (`src/core/project-session-manager.test.ts:444-542,615-650,802-823,1016-1042`; `src/core/project-session-manager.ts:62-114`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:145-159`).
- `src/core/session-runtime.test.ts` — env assertions still check `STOA_META_SESSION` and must move to `STOA_SESSION_ID`/`STOA_CTL_SESSION_TOKEN` (`src/core/session-runtime.test.ts:659-719`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:397-411,623-633`).
- `tests/e2e/store-lifecycle-sync.test.ts` — store mutation expectations need `upsertSession`, `SessionNodeSnapshot`, and tree projection coverage (`tests/e2e/store-lifecycle-sync.test.ts:89-95`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:729-756`).
- `tests/e2e/backend-lifecycle.test.ts` — most CRUD survives, but bootstrap recovery assertions need review against tree-aware recovery semantics (`tests/e2e/backend-lifecycle.test.ts:524-584`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:541-566`).
- `tests/e2e/ipc-push-harness.test.ts` — should add `session:event` envelope coverage while existing non-session pushes remain valid (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:697-716`).

#### 2. Best insertion points for new coverage

New unit coverage:

- `src/core/session-supervisor.test.ts` — root/child creation, subtree archive/restore/destroy, same-depth peer restrictions, cross-project parent rejection, event emission (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:541-566,858-883`).
- `src/core/session-visibility-service.test.ts` — `rootSessionId`, `depth`, child/descendant projection, visible-set `V(S)`, archived filtering, `graphVersion` monotonicity (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:145-168,253-269,612-622,858-883`).
- `src/core/session-control-server-unified.test.ts` — `whoami`, `capabilities`, new auth headers, `session list/create/prompt/destroy/inspect`, new authority and visibility errors (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:377-411,555-639`).
- `src/core/session-command-env.test.ts` — env injection contract for all sessions (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:397-411,623-633`).
- `src/core/session-bootstrap-prompt-service.test.ts` — bootstrap prompt must describe tree-local identity and visibility rather than meta-session/global control (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:635-657`).
- `src/core/session-caller-auth-registry.test.ts` — token mint/invalidate flow and non-persistence guarantees (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:566-611`).
- `src/core/session-graph-event.test.ts` — envelope kind, origin, initiator, node shape, and monotonic `graphVersion` (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:697-716`).

New integration and e2e coverage:

- `tests/e2e/session-tree-lifecycle.test.ts` — create root/child/grandchild, subtree destroy/restore, cross-project parent rejection, no orphaning.
- `tests/e2e/session-graph-event-sync.test.ts` — `session:event` push, `graphVersion` dedupe, background child creation, no active-session steal.
- Rewrite `tests/e2e/ipc-bridge.test.ts` around `session:create-child`, `session:prompt`, `session:destroy`, `session:inspect` (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:826-833`).
- Extend `tests/e2e/frontend-store-projection.test.ts` for `project -> root sessions -> child sessions` tree shape, `upsertSession`, and tree metadata hydration (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:729-771`).
- Extend `tests/e2e/ipc-push-harness.test.ts` for `session:event` payload validation and routing.
- Rewrite `tools/stoa-ctl/index.test.ts` around `session list/create/inspect/prompt/destroy`, local-user vs session caller auth, and authority-scope failures (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:377-411`).

#### 3. Generated, behavior, and topology assets that need updates

Replace outright:

- `testing/behavior/meta-session.behavior.ts` and `testing/behavior/meta-session.behavior.test.ts` (`testing/behavior/meta-session.behavior.ts:3-47`; `testing/behavior/meta-session.behavior.test.ts:1-39`).
- `testing/topology/meta-session.topology.ts` and `testing/topology/meta-session.topology.test.ts` (`testing/topology/meta-session.topology.ts:1-16`; `testing/topology/meta-session.topology.test.ts:1-17`).
- `testing/journeys/meta-session.journey.ts` and `testing/journeys/meta-session.journey.test.ts` (`testing/journeys/meta-session.journey.ts:1-27`; `testing/journeys/meta-session.journey.test.ts:1-38`).
- `tests/generated/playwright/meta-session-surface-session-flow.generated.spec.ts` after generator regeneration (`tests/generated/playwright/meta-session-surface-session-flow.generated.spec.ts:1-37`).

Update generator and coverage tests:

- `testing/generators/generate-playwright.ts` — remove the meta-session skeleton generator and replace it with a session-tree skeleton (`testing/generators/generate-playwright.ts:318-357`).
- `testing/generators/generate-playwright.test.ts` — replace the deterministic meta-session generator test (`testing/generators/generate-playwright.test.ts:90-103`).
- `testing/generators/behavior-coverage.test.ts` — five current cases import meta-session assets and need session-tree replacements (`testing/generators/behavior-coverage.test.ts:2-5,14-21,36-83`).

Best new assets:

- `testing/behavior/session-tree.behavior.ts` and `.test.ts`
- `testing/topology/session-tree.topology.ts` and `.test.ts`
- `testing/journeys/session-tree.journey.ts` and `.test.ts`

The contracts DSL and generic coverage logic do not appear session-model-specific and can stay in place (`testing/contracts/testing-contracts.ts:65-164`; `testing/generators/behavior-coverage.ts:28-51`).

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `SessionSummary` and persisted session schema are the work-session contract today | `src/shared/project-session.ts` | `113-186,259-263` |
| Project-session serialization/deserialization is field-coupled in manager code | `src/core/project-session-manager.ts` | `62-114` |
| Meta sessions have a separate persisted model and bootstrap surface | `src/shared/meta-session.ts` | `13-45,147-181` |
| Meta-session state store is a standalone persistence implementation | `src/core/meta-session-state-store.ts` | `1-517` |
| IPC constants currently expose separate `meta-session:*` channels | `src/core/ipc-channels.ts` | `1-95` |
| Main process currently registers meta-session handlers directly | `src/main/index.ts` | `1556-1653` |
| Unit test suite directly exercises standalone meta-session manager/state/control/dispatch/env/proposal modules | `src/core/meta-session-manager.test.ts`, `src/core/meta-session-state-store.test.ts`, `src/core/meta-session-control-server.test.ts`, `src/core/meta-session-command-dispatcher.test.ts`, `src/core/meta-session-command-env.test.ts`, `src/core/meta-session-proposal-store.test.ts` | `23-171`, `28-458`, `158-1077`, `12-385`, `5-23`, `4-50` |
| IPC bridge e2e test hard-codes meta-session invoke channels and preload API | `tests/e2e/ipc-bridge.test.ts` | `63-90,177-189,216-298,538-663` |
| Static guard e2e test hard-codes meta-session imports, methods, channels, and event names | `tests/e2e/main-config-guard.test.ts` | `193-241,266-276,418-429,530-541,594-596` |
| Frontend store projection e2e test imports `useMetaSessionStore` and old meta bootstrap types | `tests/e2e/frontend-store-projection.test.ts` | `4,10,84-177` |
| CLI test suite asserts `STOA_META_SESSION_ID` and deleted command groups | `tools/stoa-ctl/index.test.ts` | `19-22,29-51,81-107,109-176,178-382,412-609,663-843` |
| Meta-session behavior assets are explicit, not generic | `testing/behavior/meta-session.behavior.ts` | `3-47` |
| Meta-session topology assets are explicit, not generic | `testing/topology/meta-session.topology.ts` | `3-15` |
| Meta-session journeys are explicit, not generic | `testing/journeys/meta-session.journey.ts` | `3-27` |
| Playwright generator contains a dedicated meta-session skeleton generator | `testing/generators/generate-playwright.ts` | `318-357` |
| Behavior-coverage tests import meta-session assets directly | `testing/generators/behavior-coverage.test.ts` | `2-5,14-21,36-83` |
| Spec introduces `parentSessionId`, `createdBySessionId`, and tree metadata | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `145-168` |
| Spec replaces old CLI/control/env flow with unified session control and session-scoped auth | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `377-411,555-639` |
| Spec introduces `SessionGraphEvent`, `upsertSession`, and recursive tree projection | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `697-771` |
| Spec explicitly calls out new IPC channels and required testing strategy | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `826-883` |

### Risks / Unknowns

- **[!]** `buildBootstrapRecoveryPlan` is not fully re-specified. Existing lifecycle tests may need semantic rewrites, not just fixture updates (`tests/e2e/backend-lifecycle.test.ts:524-584`).
- **[!]** The exact final preload/IPC method list is not fully enumerated in the spec. `tests/e2e/main-config-guard.test.ts` and `tests/e2e/ipc-bridge.test.ts` will need the final contract before they can be stabilized.
- **[!]** The spec describes unified `session:event` semantics, but the exact channel naming and renderer dedupe path still need confirmation before static guards are rewritten (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:697-716`).
- **[?]** If session-scoped auth token wiring changes startup/runtime options or port-file contents, there may be follow-on impact beyond the currently identified env-focused tests.

## Context Handoff: Unified Session Tree Implementation Test Surface

Start here: `research/2026-05-29-impl-test-surface.md`

Context only. Use the saved report as the source of truth.
