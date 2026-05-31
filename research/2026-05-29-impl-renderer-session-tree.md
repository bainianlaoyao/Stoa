---
date: 2026-05-29
topic: renderer session tree and meta-session removal bounded implementation research
status: completed
mode: context-gathering
sources: 26
---

## Context Report: Renderer Session Tree + Meta-Session Removal

### Why This Was Gathered

This report identifies the renderer, preload, and test change points needed to replace the flat session projection with a tree built from `SessionNodeSnapshot`, and to remove the standalone meta-session store/UI surface. The target product direction is the unified session-tree design in `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:37-45,143-179,696-802`.

### Summary

The renderer is still built around a flat `SessionSummary[]` model. The workspace store groups sessions only as `Project -> sessions[]`, `CommandSurface` and `TerminalSessionDeck` only iterate top-level project session arrays, and `App.vue` still consumes `onSessionEvent(SessionSummaryEvent)` rather than a graph-aware envelope. `SessionNodeSnapshot[]` support therefore requires a contract change in shared types and preload, a store rewrite from flat projection to recursive projection, and UI changes wherever components assume `project.sessions` is flat. Evidence: `src/shared/project-session.ts:122-145,265-295,330-396`, `src/renderer/stores/workspaces.ts:11-15,32,64-87,89-99,265-321`, `src/renderer/app/App.vue:40-42,69-86,100-128,224-240`, `src/preload/index.ts:58-107,183-186`, `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:143-179,696-770`.

The requested focus paths for hierarchy/command components live in `src/renderer/components/command/`, not `src/renderer/components/workspace/`. The real implementation files are `CommandSurface.vue`, `WorkspaceHierarchyPanel.vue`, and `TerminalSessionDeck.vue` under that `command` directory. Evidence: repository paths resolved from direct file reads at `src/renderer/components/command/CommandSurface.vue:1-104`, `src/renderer/components/command/WorkspaceHierarchyPanel.vue:1-510`, `src/renderer/components/command/TerminalSessionDeck.vue:1-155`.

### Key Findings

#### 1. Exact change points for replacing flat sessions with tree projection and `SessionNodeSnapshot` payloads

- Shared contract is still flat. `SessionSummary` has no `parentSessionId` or `createdBySessionId`; `BootstrapState.sessions` is `SessionSummary[]`; `SessionSummaryEvent` only carries `{ session }`; and `RendererApi` still exposes flat session methods plus optional meta-session bridge methods. This is the root type surface that must change before renderer code can move to tree projection. Evidence: `src/shared/project-session.ts:122-145,163-186,265-295,330-396`. The target contract is spelled out in the spec: `SessionSummary.parentSessionId`, `SessionSummary.createdBySessionId`, `SessionNodeSnapshot`, and `SessionGraphEvent` at `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:143-179,708-716,826-833`.

- `useWorkspaceStore` is hard-coded to flat storage. It owns `sessions = ref<SessionSummary[]>([])`, computes `activeSession` by `find` over that flat array, derives `projectHierarchy` by filtering `sessions` into `project.sessions` and `project.archivedSessions`, hydrates from flat bootstrap state, and mutates sessions through `addSession`, `updateSession`, `archiveSession`, and `restoreSession`. These are the exact replacement points for a graph-aware `sessionNodes` store and an `upsertSession(node: SessionNodeSnapshot)` API. Evidence: `src/renderer/stores/workspaces.ts:30-37,49-59,64-99,231-246,265-321`; spec requirements at `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:696-770,877-883,913-915`.

- `CommandSurface` currently loses nested sessions even if the store changed, because it only builds view models from `for (const project of props.hierarchy) for (const session of project.sessions)` and passes the unchanged flat hierarchy to children. This must be rewritten to traverse root sessions plus descendants recursively. Evidence: `src/renderer/components/command/CommandSurface.vue:38-54,74-100`.

- `TerminalSessionDeck` has the same flat assumption. `sessionLookup` only indexes `project.sessions`, and pruning of cached terminals depends on that lookup. If child sessions move under `children`, the deck will silently fail to resolve them unless the lookup becomes recursive. Evidence: `src/renderer/components/command/TerminalSessionDeck.vue:13-17,41-54,68-85,95-102`. This is a fragile point because the persistent terminal cache logic is otherwise sound and heavily tested. Evidence: `src/renderer/components/command/TerminalSessionDeck.test.ts:111-158,204-324`.

- `WorkspaceHierarchyPanel` is still a two-level renderer. It keeps collapse state only by project id, the add-session affordance is project-scoped, session context actions only expose `restart` and `regenerate-title`, and rendering is a single `v-for="session in project.sessions"` loop. Converting to tree support means:
  - replacing project-only collapse with session-tree expansion state,
  - allowing `create child` from a session row,
  - replacing `archive` with the spec’s `destroy` / `restore` actions,
  - exposing inspect/prompt/create-child/destroy/restore at the session row level,
  - rendering nested descendants recursively with indentation and child count.
  Evidence: `src/renderer/components/command/WorkspaceHierarchyPanel.vue:40-49,86-93,104-143,174-194,222-285,343-460`; spec target UI at `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:744-802`.

- `App.vue` is wired to the old event model. On create it expects `window.stoa.createSession()` to return a `SessionSummary` and then immediately calls `workspaceStore.addSession(created)`; on bridge push it subscribes to `onSessionEvent` and calls `workspaceStore.updateSession(event.session.id, event.session)`; on bootstrap it hydrates flat `sessions`. For session-tree support this becomes the main renderer integration cutover: local create should consume `SessionNodeSnapshot`, background updates should flow through `SessionGraphEvent.node`, and unknown child sessions must be inserted without focus-steal. Evidence: `src/renderer/app/App.vue:40-42,69-86,110-128,211-240,278-295`; spec behavior at `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:696-770`.

- `preload/index.ts` is a thin but mandatory bridge rewrite. It imports `SessionSummaryEvent`, exposes `onSessionEvent`, returns flat session payloads from `getBootstrapState` and `createSession`, and still contains only archive/restore/restart session actions plus the full meta-session API block. Tree support requires updating the typed contract to `SessionNodeSnapshot[]` bootstrap payloads plus a graph event listener, and adding new session control methods for child create / prompt / destroy / inspect. Evidence: `src/preload/index.ts:4-15,58-107,183-192`; target IPC direction at `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:820-839`.

- `AppShell` has one more flat-session dependency: archive surface input is built from `props.hierarchy.flatMap(project => project.archivedSessions)`. That logic assumes archived sessions are a per-project flat list and will miss archived descendants if subtree archive/restore keeps tree shape. Evidence: `src/renderer/components/AppShell.vue:35-45,79-83`; subtree archive/restore requirement at `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:214-245`.

#### 2. What to remove or bypass from meta-session UI/store

- The standalone meta-session Pinia store is an isolated feature slice and can be removed wholesale. It owns its own bootstrap path, session list, active session selection, proposal queue, inspector target, and event subscription surface, all completely separate from `useWorkspaceStore`. Evidence: `src/renderer/stores/meta-session.ts:34-39,74-153,155-241,248-273`; tests showing the same isolated model at `src/renderer/stores/meta-session.test.ts:223-388`.

- `App.vue` still boots and tears down the meta-session feature. The direct removal points are:
  - `useMetaSessionStore` import and store instantiation,
  - `unsubscribeMetaSessionEvents`,
  - `metaSessionStore.bootstrapFromBridge()` during mount,
  - `metaSessionStore.unsubscribe()` during unmount.
  Evidence: `src/renderer/app/App.vue:14,23,156,240-246,263-272`.

- `AppShell.vue` still imports and conditionally renders `MetaSessionSurface`, and forwards `create-workspace-session` from that surface into the generic `createSession` emit. That whole branch is removable once the standalone meta-session product surface is gone. Evidence: `src/renderer/components/AppShell.vue:3-8,35,52-84`.

- `GlobalActivityBar.vue` still treats meta-session as a first-class surface via `AppSurface = 'command' | 'meta-session' | 'archive' | 'settings'` and a top-cluster `meta-session` item. Removing the product surface requires narrowing that union and deleting the corresponding button and icon expectations. Evidence: `src/renderer/components/GlobalActivityBar.vue:6,34-56,88-132`.

- The meta-session component stack is self-contained and removable:
  - `MetaSessionSurface.vue` composes the session list, terminal deck, and inspector panel under `data-testid="surface.meta-session"`: `src/renderer/components/meta-session/MetaSessionSurface.vue:3-19`.
  - `MetaSessionSessionList.vue` is a complete alternate session sidebar with create/archive/restore flows and its own provider filtering: `src/renderer/components/meta-session/MetaSessionSessionList.vue:5-48,97-108,131-263`.
  - `MetaSessionTerminalDeck.vue` synthesizes fake `SessionSummary` objects just to feed `TerminalViewport`, which becomes dead once everything is a normal session tree node: `src/renderer/components/meta-session/MetaSessionTerminalDeck.vue:8-61,64-81`.
  - `MetaSessionInspectorPanel.vue` and `MetaSessionActionPanel.vue` are proposal/approval UI bound directly to the meta-session store: `src/renderer/components/meta-session/MetaSessionInspectorPanel.vue:7-24,27-99`; `src/renderer/components/meta-session/MetaSessionActionPanel.vue:5-7,16-50`.

- Shared/meta-session bridge types become removable from the renderer path as well:
  - `src/shared/meta-session.ts` defines the removed product model: `src/shared/meta-session.ts:13-28,80-98,170-193`.
  - `src/shared/project-session.ts` re-exports meta-session request/response types and keeps 12 optional meta-session bridge methods on `RendererApi`: `src/shared/project-session.ts:12-19,385-396`.
  - `src/shared/provider-descriptors.ts` still exposes `isMetaSessionProvider` and `listMetaSessionProviderDescriptors`, used only by meta-session UI: `src/shared/provider-descriptors.ts:76-81`; consumer at `src/renderer/components/meta-session/MetaSessionSessionList.vue:4-7,38-48`.

- `preload/index.ts` still exposes the entire meta-session IPC surface and listener registration. Those methods are bypass/remove points, not migration targets: `src/preload/index.ts:108-141,188-192`.

#### 3. Vue/component testing implications and fragile points

- Workspace store tests are flat-shape dependent. `workspaces.test.ts` asserts direct access to `projectHierarchy[0].sessions`, `projectHierarchy[0].archivedSessions`, and uses `addSession` / `updateSession` semantics. These tests will need a wholesale rewrite around recursive projection and `upsertSession`. Evidence: `src/renderer/stores/workspaces.test.ts:266-315,380-431,438-492,1222-1269`.

- `App.test.ts` will break at the bridge seam even though it stubs most UI internals. Its `window.stoa` mock provides `onSessionEvent`, returns flat `sessions` from bootstrap, asserts session creation through `createSession -> store.sessions`, and tests archive/restore semantics by inspecting `store.sessions[0].archived` and `projectHierarchy[0].sessions`. Evidence: `src/renderer/app/App.test.ts:158-185,291-308,358-366,785-893,1012-1058`. `tests/e2e/app-bridge-guard.test.ts` also hardcodes `onSessionEvent` in the bridge mock surface: `tests/e2e/app-bridge-guard.test.ts:120-123`.

- `WorkspaceHierarchyPanel.test.ts`, `CommandSurface.test.ts`, and `TerminalSessionDeck.test.ts` are all written around a flat `ProjectHierarchyNode` fixture where sessions live only in `project.sessions`. These tests cover a lot of behavior and are the highest-risk UI refactor surface:
  - hierarchy rendering and selection expect flat rows: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts:45-109,293-330,443-460,484-535`.
  - command surface view-model derivation assumes flat rows: `src/renderer/components/command/CommandSurface.test.ts:20-82,198-257,298-352`.
  - terminal deck lookup/pruning assumes flat hierarchy and direct `hierarchyFixture(...).sessions`: `src/renderer/components/command/TerminalSessionDeck.test.ts:94-109,111-158,290-324`.

- `AppShell.test.ts` and `GlobalActivityBar.test.ts` explicitly assert the presence of the meta-session surface/button. Those tests must be rewritten or deleted in tandem with the UI removal, not after. Evidence: `src/renderer/components/AppShell.test.ts:87-102,163-168,291-315,342-361,416-449`; `src/renderer/components/GlobalActivityBar.test.ts:6-8,22-47,78-87`.

- E2E/store projection tests are also brittle:
  - `tests/e2e/frontend-store-projection.test.ts` contains an entire meta-session projection phase plus many `projectHierarchy[*].sessions` assumptions, so it is not a simple fixture update. Evidence: `tests/e2e/frontend-store-projection.test.ts:84-176,295-430`.
  - `tests/e2e/ipc-bridge.test.ts` is deeply wired to `MetaSessionManager`, `MetaSessionCommandDispatcher`, meta-session IPC constants, and meta-session preload API round-trips. Those tests need removal/replacement, not adaptation. Evidence from direct references at `tests/e2e/ipc-bridge.test.ts:3-5,71-81,176-188,216-299,403-413,451-658,827-837`.
  - `tests/e2e/main-config-guard.test.ts` currently guards meta-session helper functions, prompt imports, preload methods, and channel mappings. Those assertions will fail until rewritten against the unified session tree/control surface. Evidence: `tests/e2e/main-config-guard.test.ts:193-240,243-276,417-540,594-595`.

- Behavior/topology/journey assets will also fail unless updated. There are dedicated `meta-session` behavior declarations, topology contracts, journey contracts, generator tests, and generated Playwright skeleton generation rules that all encode the removed surface and its test ids. Evidence: `testing/behavior/meta-session.behavior.ts:3-34`, `testing/topology/meta-session.topology.ts:3-14`, `testing/journeys/meta-session.journey.ts:3-23`, `testing/generators/generate-playwright.ts:318-349`, `testing/generators/write-generated-playwright.ts:31-33`. The existing command topology contract also hardcodes only flat project/session ids like `project-row`, `session-row`, and `workspace.archive-session`, so tree-node-level ids need careful extension rather than ad hoc renaming. Evidence: `testing/topology/command.topology.ts:3-19`.

- UI refactors must stay inside the existing design language. The design doc requires token-driven visuals, z-axis hierarchy over heavy framing, restrained motion, and `--font-mono` for exact technical identifiers. This matters because session-tree indentation, child-count badges, and new row actions are likely to invite new visual primitives. Evidence: `docs/engineering/design-language.md:5-24,39-58,63-113`.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Unified design replaces meta session with one session tree and `SessionNodeSnapshot` read model | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `37-45`, `143-179`, `696-802` |
| Shared renderer contract is still flat and still exports meta-session methods | `src/shared/project-session.ts` | `122-145`, `265-295`, `330-396` |
| Workspace store is flat and mutation model is `add/update/archive/restore` | `src/renderer/stores/workspaces.ts` | `30-37`, `64-99`, `265-321` |
| App bridge wiring uses `onSessionEvent` and flat create/bootstrap flow | `src/renderer/app/App.vue` | `69-86`, `211-240`, `278-295` |
| Preload bridge still exposes flat session event and full meta-session API | `src/preload/index.ts` | `58-107`, `108-141`, `183-192` |
| CommandSurface only iterates `project.sessions` | `src/renderer/components/command/CommandSurface.vue` | `38-54` |
| TerminalSessionDeck only indexes top-level `project.sessions` | `src/renderer/components/command/TerminalSessionDeck.vue` | `41-54`, `68-85` |
| WorkspaceHierarchyPanel renders only two levels and lacks child/destroy/prompt/inspect actions | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | `40-49`, `104-143`, `343-460` |
| AppShell archive aggregation is flat per-project | `src/renderer/components/AppShell.vue` | `35-45` |
| Meta-session store is an isolated renderer feature slice | `src/renderer/stores/meta-session.ts` | `34-39`, `74-153`, `155-241` |
| App and shell still mount/bootstrap meta-session surface | `src/renderer/app/App.vue`, `src/renderer/components/AppShell.vue` | `14,23,156,240-246,263-272`; `3-8,74-78` |
| Global activity bar still exposes `meta-session` surface | `src/renderer/components/GlobalActivityBar.vue` | `6`, `34-56` |
| Meta-session component tree is standalone and removable | `src/renderer/components/meta-session/*.vue` | `MetaSessionSurface.vue:3-19`, `MetaSessionSessionList.vue:11-48,131-263`, `MetaSessionTerminalDeck.vue:8-81`, `MetaSessionInspectorPanel.vue:7-99`, `MetaSessionActionPanel.vue:5-50` |
| Workspace/component tests assume flat `project.sessions` | `WorkspaceHierarchyPanel.test.ts`, `CommandSurface.test.ts`, `TerminalSessionDeck.test.ts` | `45-109,293-330,443-460`; `20-82,198-257`; `94-109,111-158` |
| AppShell and activity bar tests assert meta-session UI presence | `AppShell.test.ts`, `GlobalActivityBar.test.ts` | `291-315,342-361,416-449`; `22-47,78-87` |
| E2E store projection test contains both meta-session projection and flat hierarchy assumptions | `tests/e2e/frontend-store-projection.test.ts` | `84-176`, `295-430` |
| Config/IPC guard tests explicitly pin meta-session channels and preload methods | `tests/e2e/main-config-guard.test.ts`, `tests/e2e/ipc-bridge.test.ts` | `193-240`, `243-276`, `417-540`, `594-595`; `71-81`, `176-188`, `403-413` |
| Behavior/topology/journey/generator assets encode meta-session surface ids and flows | `testing/behavior/meta-session.behavior.ts`, `testing/topology/meta-session.topology.ts`, `testing/journeys/meta-session.journey.ts`, `testing/generators/generate-playwright.ts` | `3-34`; `3-14`; `3-23`; `318-349` |

### Risks / Unknowns

- [!] Archive semantics are not a drop-in change. Current renderer splits active vs archived sessions into separate arrays and a separate archive surface, while the spec defines subtree destroy/restore and session-row restore/destroy actions. Renderer work will need a deliberate product/UI decision on whether archived subtrees remain only in archive view or become visible in-tree. Evidence: `src/renderer/stores/workspaces.ts:73-85,308-321`; `src/renderer/components/AppShell.vue:37-45,79-83`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:214-245,789-802`.

- [!] Auto-expand behavior for background-created children does not exist today. The spec requires parent auto-expand on `kind = "created"`, but current hierarchy state only tracks collapsed project ids, not collapsed session ids. Evidence: `src/renderer/components/command/WorkspaceHierarchyPanel.vue:54,174-194`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:722-723,758-770,877-883`.

- [!] The renderer cannot complete this refactor alone. It depends on backend/shared changes to emit `SessionNodeSnapshot[]` bootstrap data and `SessionGraphEvent` push events. Until those contracts exist, renderer-side work can only stub the new shape locally. Evidence: `src/shared/project-session.ts:265-295`; `src/preload/index.ts:58-62,183-186`; `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:696-716,754-756`.

- [?] The exact future of the archive surface is not explicit in the spec. The spec clearly removes meta-session surface and archive row action, but does not explicitly say whether the top-level archive activity bar surface remains. Evidence: `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:338-359,789-802`.

## Context Handoff: Renderer Session Tree + Meta-Session Removal

Start here: `research/2026-05-29-impl-renderer-session-tree.md`

Context only. Use the saved report as the source of truth.
