---
date: 2026-05-29
topic: renderer meta-session store and UI removal/bypass points
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Renderer Meta-Session Removal Points

### Why This Was Gathered

To identify every file and exact location in the renderer layer that must be touched to remove or bypass the meta-session (session tree) feature.

### Summary

The meta-session feature occupies a dedicated surface in the app's activity bar and has its own Pinia store, 5 Vue components, shared type definitions, and 12 preload bridge methods. Removal touches 3 layers: shared types + bridge contract, the Pinia store, and the UI component tree (activity bar button + surface slot in AppShell + bootstrap lifecycle in App.vue).

### Key Findings

#### Layer 1 — Shared Types & Bridge Contract

- **`src/shared/meta-session.ts`** (199 lines) — all types: MetaSessionSummary, MetaSessionProposal, MetaSessionInspectorTarget, MetaSessionBootstrapState, CreateMetaSessionRequest, MetaSessionEvent, persisted variants, etc. Entire file is meta-session-only.
- **`src/shared/project-session.ts:13-19`** — re-exports 7 meta-session types from ./meta-session.
- **`src/shared/project-session.ts:385-396`** — 12 optional methods on RendererApi bridge: getMetaSessionBootstrapState, createMetaSession, setActiveMetaSession, archiveMetaSession, restoreMetaSession, listMetaSessionProposals, getMetaSessionProposal, approveMetaSessionProposal, rejectMetaSessionProposal, dispatchMetaSessionProposal, setMetaSessionInspectorTarget, onMetaSessionEvent. All are optional so the store already guards with ?..
- **`src/shared/provider-descriptors.ts:76-82`** — isMetaSessionProvider() and listMetaSessionProviderDescriptors() used by MetaSessionSessionList.vue.

#### Layer 2 — Pinia Store

- **`src/renderer/stores/meta-session.ts`** (274 lines) — full store. Exposes: sessions, activeMetaSessionId, inspectorTarget, proposals, computed getters, and async actions for CRUD + proposal lifecycle. Uses window.stoa bridge methods (all optional-chaired).

#### Layer 3 — UI Components (5 files + 1 test)

| File | Lines | Role |
|------|-------|------|
| src/renderer/components/meta-session/MetaSessionSurface.vue | 36 | Surface root: 3-column grid (SessionList, TerminalDeck, InspectorPanel) |
| src/renderer/components/meta-session/MetaSessionSessionList.vue | 582 | Sidebar: list/create/archive/restore sessions, provider floating card |
| src/renderer/components/meta-session/MetaSessionTerminalDeck.vue | 108 | Terminal viewport deck: maps meta-session summaries to SessionSummary and renders TerminalViewport per session |
| src/renderer/components/meta-session/MetaSessionInspectorPanel.vue | 213 | Right panel: global brief, inspector target, proposals, risk, action panel |
| src/renderer/components/meta-session/MetaSessionActionPanel.vue | 118 | Approve/Reject/Dispatch/Archive action buttons |
| src/renderer/components/meta-session/MetaSessionSurface.test.ts | — | Component tests for MetaSessionSurface |

#### Layer 4 — Integration Points (where meta-session is wired into the app shell)

1. **`src/renderer/components/AppShell.vue`**
   - L6: import MetaSessionSurface from './meta-session/MetaSessionSurface.vue'
   - L74-78: MetaSessionSurface v-if="activeSurface === 'meta-session'" slot
   - L77: emits createWorkspaceSession up to App.vue

2. **`src/renderer/components/GlobalActivityBar.vue`**
   - L6: AppSurface type includes 'meta-session'
   - L46-55: Activity bar button for id: 'meta-session' with icon

3. **`src/renderer/app/App.vue`**
   - L14: import { useMetaSessionStore } from '@renderer/stores/meta-session'
   - L23: const metaSessionStore = useMetaSessionStore()
   - L156: let unsubscribeMetaSessionEvents: (() => void) | null = null
   - L240: unsubscribeMetaSessionEvents = await metaSessionStore.bootstrapFromBridge() — bootstraps after workspace hydrate
   - L268: unsubscribeMetaSessionEvents?.() — cleanup
   - L271: metaSessionStore.unsubscribe() — cleanup

#### Layer 5 — Test References

- **`src/renderer/components/AppShell.test.ts`** — has MetaSessionSurfaceStub, tests meta-session surface visibility (L87-88, L95-96, L307, L342-355, L432)
- **`src/renderer/components/GlobalActivityBar.test.ts`** — references 'meta-session' in surface assertions (L6, L27, L35)

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Store: full meta-session Pinia store | src/renderer/stores/meta-session.ts | entire file (274 lines) |
| Types: all shared meta-session types | src/shared/meta-session.ts | entire file (199 lines) |
| Bridge: 12 optional RendererApi methods | src/shared/project-session.ts | L385-396 |
| Re-exports: 7 types from meta-session | src/shared/project-session.ts | L13-19 |
| Provider filter: isMetaSessionProvider | src/shared/provider-descriptors.ts | L76-82 |
| Surface: MetaSessionSurface in AppShell | src/renderer/components/AppShell.vue | L6, L74-78 |
| Activity bar button | src/renderer/components/GlobalActivityBar.vue | L6, L46-55 |
| Bootstrap lifecycle in App.vue | src/renderer/app/App.vue | L14, L23, L156, L240-246, L268-272 |
| 5 component files | src/renderer/components/meta-session/* | all 5 .vue files |
| AppShell test references | src/renderer/components/AppShell.test.ts | L87-88, L307, L342 |
| ActivityBar test references | src/renderer/components/GlobalActivityBar.test.ts | L6, L27, L35 |

### Risks / Unknowns

- [!] TerminalSessionDeck.vue does NOT exist at src/renderer/components/workspace/TerminalSessionDeck.vue — the actual deck used by CommandSurface is at src/renderer/components/workspace/TerminalSessionDeck.vue (imported at CommandSurface.vue:5). The meta-session terminal deck is MetaSessionTerminalDeck.vue which wraps TerminalViewport with a synthetic SessionSummary mapping (L19-57). Removing meta-session does NOT remove TerminalViewport.
- [!] The AppSurface type ('command' | 'meta-session' | 'archive' | 'settings') is defined in GlobalActivityBar.vue:6 and must have 'meta-session' removed.
- [!] MetaSessionTerminalDeck.vue creates a synthetic META_SESSION_PROJECT constant (L8-14) to map meta-session summaries into SessionSummary shape — this mapping layer would be removed entirely.
- [!] The store uses window.stoa bridge methods (all optional) so the renderer will not crash if bridge methods are absent, but the activity bar button and surface slot should be removed to avoid dead UI.
