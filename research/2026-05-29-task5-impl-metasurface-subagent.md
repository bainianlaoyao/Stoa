---
date: 2026-05-29
topic: Task 5 renderer meta-session surface cutover context
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Task 5 Renderer Meta-Session Surface Cutover

### Why This Was Gathered

Task 5 of the unified session tree plan requires removing the independent meta-session product surface from the renderer. This report maps every dependency so the implementer knows exactly which wires to cut and which tests should go RED first.

### Summary

The meta-session product surface spans 4 components under `src/renderer/components/meta-session/`, 1 Pinia store, the `AppSurface` union type, the activity bar button, 1 preload bridge binding block, 12 `RendererApi` bridge methods, and the App.vue bootstrap lifecycle. Removing it requires changes in 6 whitelisted files plus deletion of 7 files.

### Key Findings

#### Finding 1: AppShell.vue renders MetaSessionSurface conditionally

AppShell.vue imports and renders `<MetaSessionSurface>` when `activeSurface === 'meta-session'`. It also receives the `AppSurface` type from GlobalActivityBar.vue which includes `'meta-session'`.

| Item | Location |
|------|----------|
| Import of MetaSessionSurface | `src/renderer/components/AppShell.vue:6` |
| Conditional render block | `src/renderer/components/AppShell.vue:74-78` |
| `createWorkspaceSession` event forwarding | `src/renderer/components/AppShell.vue:77` |

#### Finding 2: GlobalActivityBar.vue defines 'meta-session' in AppSurface type and topItems

The `AppSurface` union type and the `topItems` array both include the meta-session entry. The bar renders a button with `data-activity-item="meta-session"` and `data-icon-kind="meta-session-orbit"`.

| Item | Location |
|------|----------|
| `AppSurface` type includes `'meta-session'` | `src/renderer/components/GlobalActivityBar.vue:6` |
| `topItems` meta-session entry | `src/renderer/components/GlobalActivityBar.vue:46-55` |
| Button renders with aria-label from `t('activityBar.metaSession')` | `src/renderer/components/GlobalActivityBar.vue:99` |

#### Finding 3: App.vue bootstraps the meta-session store lifecycle

App.vue imports and instantiates the meta-session store, bootstraps it from the bridge after workspace hydration, and cleans up on unmount.

| Item | Location |
|------|----------|
| Import `useMetaSessionStore` | `src/renderer/app/App.vue:14` |
| Store instantiation | `src/renderer/app/App.vue:23` |
| Bootstrap call `metaSessionStore.bootstrapFromBridge()` | `src/renderer/app/App.vue:240` |
| Unmount cleanup: `unsubscribeMetaSessionEvents?.()` | `src/renderer/app/App.vue:268` |
| Unmount cleanup: `metaSessionStore.unsubscribe()` | `src/renderer/app/App.vue:271` |
| Variable declaration `unsubscribeMetaSessionEvents` | `src/renderer/app/App.vue:156` |

#### Finding 4: meta-session store is a full Pinia store with bridge dependencies

`src/renderer/stores/meta-session.ts` (274 lines) manages sessions, proposals, inspector state, and 12 async bridge calls.

| Store concern | Methods |
|---------------|---------|
| Sessions | `hydrate`, `bootstrapFromBridge`, `createSession`, `setActiveSession`, `archiveSession`, `restoreSession` |
| Proposals | `refreshProposals`, `refreshProposal`, `approveProposal`, `rejectProposal`, `approveAndDispatchProposal` |
| Inspector | `setInspector` |
| Event stream | `applySessionEvent`, `unsubscribe` |

Bridge methods used via `window.stoa`:
- `getMetaSessionBootstrapState`, `createMetaSession`, `setActiveMetaSession`, `archiveMetaSession`, `restoreMetaSession`
- `listMetaSessionProposals`, `getMetaSessionProposal`, `approveMetaSessionProposal`, `rejectMetaSessionProposal`, `dispatchMetaSessionProposal`
- `setMetaSessionInspectorTarget`, `onMetaSessionEvent`

#### Finding 5: 4 meta-session sub-components form a complete product surface

| Component | Role | Store dependency |
|-----------|------|-----------------|
| `MetaSessionSurface.vue` | Layout shell (3-column grid) | none (delegates to children) |
| `MetaSessionSessionList.vue` | Left rail: session list, create, archive, restore | `useMetaSessionStore` |
| `MetaSessionTerminalDeck.vue` | Center: maps MetaSessionSummary→SessionSummary for TerminalViewport | `useMetaSessionStore` |
| `MetaSessionInspectorPanel.vue` | Right rail: proposals, risk, inspector target | `useMetaSessionStore` |
| `MetaSessionActionPanel.vue` | Actions: approve, reject, dispatch, archive | `useMetaSessionStore` |

#### Finding 6: Preload bridge has 12 meta-session IPC bindings + 1 event listener

`src/preload/index.ts` lines 108-139 expose 12 async methods and line 188-191 exposes `onMetaSessionEvent`. All route through `IPC_CHANNELS.*` constants.

### Tests That Should Go RED First

The TDD approach for Task 5 is to write tests asserting the *new* state (no meta-session surface) and watch them fail against the *current* code.

#### Priority 1 — AppShell.test.ts tests to modify/write:

| Test | What to assert | Lines in current file |
|------|----------------|----------------------|
| "shows all top-level activity items" | Activity labels should NOT include `'meta-session'` | `AppShell.test.ts:291-316` |
| NEW: "does not render meta-session surface" | Assert `wrapper.find('[data-surface="meta-session"]').exists()` is false | — |
| "keeps command surface mounted and hidden when the meta-session activity is selected" | DELETE this test entirely | `AppShell.test.ts:342-361` |
| "keeps activity icons rendered while switching surfaces" | Remove meta-session assertions, switch only between command/archive/settings | `AppShell.test.ts:416-450` |
| `MetaSessionSurfaceStub` definition | DELETE the stub entirely | `AppShell.test.ts:87-102` |
| `stubs` in `mountAppShell` | Remove `MetaSessionSurface` from stubs | `AppShell.test.ts:164-168` |

#### Priority 2 — GlobalActivityBar.test.ts tests to modify/write:

| Test | What to assert | Lines in current file |
|------|----------------|----------------------|
| "renders 4 activity items" | Change expected count from 4 to 3 (command, archive, settings) | `GlobalActivityBar.test.ts:22-28` |
| "renders one stable svg icon for each activity item" | Change count from 4 to 3, remove meta-session icon assertion | `GlobalActivityBar.test.ts:30-38` |
| "uses semantic sidebar icons..." | Remove `meta-session-orbit` assertion | `GlobalActivityBar.test.ts:40-48` |
| "renders command and meta-session in top cluster..." | Remove meta-session from top cluster, update bottom cluster | `GlobalActivityBar.test.ts:78-87` |
| NEW: "does not render meta-session activity item" | Assert no `data-activity-item="meta-session"` | — |

#### Priority 3 — meta-session.test.ts (entire file):

All 6 tests should be deleted when the store is removed. File: `src/renderer/stores/meta-session.test.ts` (388 lines)

#### Priority 4 — MetaSessionSurface.test.ts (entire file):

All 4 tests should be deleted when the surface is removed. File: `src/renderer/components/meta-session/MetaSessionSurface.test.ts` (279 lines)

#### Priority 5 — App.vue/App.test.ts:

The App.vue bootstrap removes the meta-session store bootstrap. If `App.test.ts` tests the bootstrap sequence, add a test asserting `metaSessionStore.bootstrapFromBridge` is NOT called.

### Minimal File-Local Cutover Suggestions (Whitelist Only)

#### AppShell.vue — 3 cuts:

1. **Line 6**: Remove `import MetaSessionSurface from './meta-session/MetaSessionSurface.vue'`
2. **Lines 74-78**: Remove the `<MetaSessionSurface>` block and its `@create-workspace-session` handler
3. The `AppSurface` type narrowing happens automatically when GlobalActivityBar removes it

#### GlobalActivityBar.vue — 2 cuts:

1. **Line 6**: Remove `'meta-session'` from `AppSurface` union: `type AppSurface = 'command' | 'archive' | 'settings'`
2. **Lines 46-55**: Remove the meta-session entry from `topItems` array

#### App.vue — 4 cuts:

1. **Line 14**: Remove `import { useMetaSessionStore } from '@renderer/stores/meta-session'`
2. **Line 23**: Remove `const metaSessionStore = useMetaSessionStore()`
3. **Line 156**: Remove `let unsubscribeMetaSessionEvents: (() => void) | null = null`
4. **Lines 240-244**: Remove the meta-session bootstrap block (`unsubscribeMetaSessionEvents = await metaSessionStore.bootstrapFromBridge()` and its early-return guard)
5. **Lines 268, 271**: Remove cleanup calls in `onBeforeUnmount`

#### Stores — delete files:

- Delete: `src/renderer/stores/meta-session.ts`
- Delete: `src/renderer/stores/meta-session.test.ts`

#### Components — delete directory:

- Delete: `src/renderer/components/meta-session/` (6 files: 4 .vue + 1 .test.ts + MetaSessionSurface.vue)

#### Preload (not in whitelist but required):

`src/preload/index.ts` lines 108-139, 188-191 — remove the 12 meta-session bridge methods and the event listener. This is listed in the Task 5 file list but was NOT in the user's research whitelist.

#### Shared types (not in whitelist but downstream):

`src/shared/meta-session.ts` (199 lines) — the entire file. Referenced by `src/shared/project-session.ts` (RendererApi interface, lines 411-422). Removing the `RendererApi` meta-session methods is part of the preload/contract cleanup in Task 5 but not in this research scope.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| AppShell imports MetaSessionSurface | `src/renderer/components/AppShell.vue` | `:6` |
| AppShell renders MetaSessionSurface | `src/renderer/components/AppShell.vue` | `:74-78` |
| AppSurface type includes 'meta-session' | `src/renderer/components/GlobalActivityBar.vue` | `:6` |
| topItems includes meta-session entry | `src/renderer/components/GlobalActivityBar.vue` | `:46-55` |
| App.vue imports meta-session store | `src/renderer/app/App.vue` | `:14` |
| App.vue bootstraps meta-session store | `src/renderer/app/App.vue` | `:240` |
| App.vue cleans up meta-session store | `src/renderer/app/App.vue` | `:268, :271` |
| MetaSessionSurface layout shell | `src/renderer/components/meta-session/MetaSessionSurface.vue` | `:1-37` |
| MetaSessionSessionList uses store | `src/renderer/components/meta-session/MetaSessionSessionList.vue` | `:7, :11-12` |
| MetaSessionTerminalDeck maps to SessionSummary | `src/renderer/components/meta-session/MetaSessionTerminalDeck.vue` | `:5, :16-17` |
| MetaSessionInspectorPanel uses store | `src/renderer/components/meta-session/MetaSessionInspectorPanel.vue` | `:4, :7-8` |
| MetaSessionActionPanel uses store | `src/renderer/components/meta-session/MetaSessionActionPanel.vue` | `:3, :5-6` |
| Store has 12 bridge methods | `src/renderer/stores/meta-session.ts` | `:136-241` |
| RendererApi has 12 meta-session methods | `src/shared/project-session.ts` | `:411-422` |
| Preload has 12 IPC bindings + 1 listener | `src/preload/index.ts` | `:108-139, :188-191` |
| AppShell test has MetaSessionSurfaceStub | `src/renderer/components/AppShell.test.ts` | `:87-102` |
| AppShell test for meta-session surface | `src/renderer/components/AppShell.test.ts` | `:342-361` |
| GlobalActivityBar test asserts 4 items | `src/renderer/components/GlobalActivityBar.test.ts` | `:22-28` |
| Meta-session store test suite | `src/renderer/stores/meta-session.test.ts` | `:223-388` |
| MetaSessionSurface test suite | `src/renderer/components/meta-session/MetaSessionSurface.test.ts` | `:173-279` |

### Risks / Unknowns

- **[!] Preload contract not in whitelist**: The preload bridge and `RendererApi` interface changes are required for a clean cutover but are outside the user's file whitelist. Task 5 plan includes `src/preload/index.ts` in scope.
- **[!] i18n keys**: `activityBar.metaSession` is used in `en.ts:282` and `zh-CN.ts:282`. These orphan keys will remain unless the i18n files are also updated.
- **[!] `@shared/meta-session` types**: `meta-session.ts` store and all sub-components import from `@shared/meta-session`. The plan says "delete or stop referencing" these files but the shared types file may still be needed by core/backend code in earlier tasks. Check Task 1-4 scope before deleting `src/shared/meta-session.ts`.
- **[!] Task 5 plan step order**: The plan says write RED tests first (step 1), then implement (step 3). The "RED" tests should assert the new state (no meta-session), not the old state.
- **[?] `ProviderFloatingCard` in MetaSessionSessionList**: This component is shared with the command surface. Verify that removing MetaSessionSessionList does not break the floating card import chain.
- **[?] `TerminalViewport` usage in MetaSessionTerminalDeck**: The terminal deck maps meta-session summaries to work-session `SessionSummary` shape for reuse. In the unified tree, subsessions will use `TerminalViewport` directly through the command surface — no adapter needed.
