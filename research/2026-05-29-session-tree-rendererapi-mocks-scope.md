---
date: 2026-05-29
topic: RendererApi mock cleanup scope for session tree changes
status: completed
mode: context-gathering
sources: 18
---

## Context Report: RendererApi Mock Signature Cleanup Scope

### Why This Was Gathered
Identify all test files and helper files that mock `window.stoa` / `window.vibecoding` / `RendererApi` and will need updates once `session:create-child`, `session:prompt`, `session:destroy`, `session:inspect` land in the `RendererApi` interface — per the unified session tree design spec (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:928–931`).

### Summary

15 test/helper files define `RendererApi` mock objects. Most use a shared pattern: a factory function that spreads ~90 method stubs, then allows `overrides`. The **main gap** across all mocks is that **none currently include the 4 new session-tree methods** (`sessionCreateChild`, `sessionPrompt`, `sessionDestroy`, `sessionInspect` or equivalents). Additionally, mocks in `meta-session.test.ts` and `MetaSessionSurface.test.ts` implement the **12 optional meta-session methods** that the new design marks for removal (`src/shared/project-session.ts:385–396`), while `ipc-bridge.test.ts` and `ipc-push-harness.test.ts` are minimal and cover only a subset.

### Key Findings

1. **15 files** define `RendererApi` mock factories or partial mocks.
2. **14 are unit/component test files** that need new stubs added.
3. **1 is an E2E helper harness** (`ipc-push-harness.test.ts`) that will need channel registration added.
4. **1 is a Playwright MCP mock** (`.playwright-mcp/mock-vibecoding.js`) — JS, not TypeScript.
5. **1 is `main-config-guard.test.ts`** — static analysis test that will catch if the concrete API/preload is out of sync.
6. **No file** currently implements `sessionCreateChild`, `sessionPrompt`, `sessionDestroy`, or `sessionInspect`.
7. **`ipc-bridge.test.ts:167`** is the most complete harness; it wraps all `IPC_CHANNELS` invoke/send methods.
8. **`ipc-push-harness.test.ts:15`** is the most minimal — only 7 methods, missing most.
9. **`meta-session.test.ts`** and **`MetaSessionSurface.test.ts`** implement the 12 optional meta-session methods that the spec says are being **removed** — these mocks will need to be removed or replaced entirely.
10. **`frontend-store-projection.test.ts:27`** is a partial mock — `Partial<RendererApi>` typed, missing ~30 required methods. Still works via `Partial<>`.
11. **`app-bridge-guard.test.ts:60`** does not import `RendererApi` type — uses inline `typeof window.stoa` for a loose mock; less at risk of TypeScript errors.
12. **`update-bridge.test.ts:24`** uses `Pick<RendererApi, ...>` for a minimal subset — unaffected unless update-related methods change.
13. **Bootstrap state mocks** in all files return `sessions: []` — will need `parentSessionId` / `createdBySessionId` fields added to `SessionSummary` shape.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| RendererApi interface definition | `src/shared/project-session.ts` | lines 330–425 |
| Preload implements all RendererApi methods | `src/preload/index.ts` | lines 58–351 |
| IPC_CHANNELS constants (no session:create-child etc. yet) | `src/core/ipc-channels.ts` | lines 1–95 |
| Design spec mentions 4 new IPC channels needed | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | lines 928–931 |
| Workspaces store test mock — full stub set, missing new session-tree methods | `src/renderer/stores/workspaces.test.ts` | lines 21–160 |
| Meta-session store test mock — implements 12 meta-session methods marked for removal + partial RendererApi | `src/renderer/stores/meta-session.test.ts` | lines 73–220 |
| Update store test mock — full stub set | `src/renderer/stores/update.test.ts` | lines 21–105 |
| Settings store test mock — full stub set | `src/renderer/stores/settings.test.ts` | lines 7–104 |
| AppShell component test — inline stoaMock object | `src/renderer/components/AppShell.test.ts` | lines 176–280 |
| MetaSessionSurface component test — implements all 12 meta-session methods | `src/renderer/components/meta-session/MetaSessionSurface.test.ts` | lines 10–145 |
| AboutSettings component test mock | `src/renderer/components/settings/AboutSettings.test.ts` | lines 24–108 |
| GeneralSettings component test mock | `src/renderer/components/settings/GeneralSettings.test.ts` | lines 9–120 |
| ProvidersSettings component test mock | `src/renderer/components/settings/ProvidersSettings.test.ts` | lines 19–130 |
| E2E IPC bridge test — complete harness wrapping IPC channels | `tests/e2e/ipc-bridge.test.ts` | lines 167–430 |
| E2E IPC push harness — minimal mock (only 7 methods) | `tests/e2e/ipc-push-harness.test.ts` | lines 15–46 |
| E2E frontend store projection — partial mock with `Record<string, ...>` typing | `tests/e2e/frontend-store-projection.test.ts` | lines 27–73 |
| E2E app bridge guard test — inline mock without RendererApi import | `tests/e2e/app-bridge-guard.test.ts` | lines 60–130 |
| E2E update bridge test — Pick<RendererApi, ...> subset | `tests/e2e/update-bridge.test.ts` | lines 24–34 |
| Playwright MCP mock — JS-only, session:create/session:event stubs | `.playwright-mcp/mock-vibecoding.js` | lines 6–81 |
| App.vue test — full stoa mock with 90+ methods | `src/renderer/app/App.test.ts` | lines 158–290 |
| Main config guard — static analysis for RendererApi method coverage | `tests/e2e/main-config-guard.test.ts` | lines 244–460 |

### SessionTree-Specific Method Gaps

The following methods are **not yet in `RendererApi`** (per current `src/shared/project-session.ts:330–425` and `src/core/ipc-channels.ts`) and are **not in any test mock**:

| New Method (planned) | Likely IPC Channel | Required In Mocks |
|---------------------|-------------------|-------------------|
| `sessionCreateChild` | `session:create-child` | 15 files |
| `sessionPrompt` | `session:prompt` | 15 files |
| `sessionDestroy` | `session:destroy` | 15 files |
| `sessionInspect` | `session:inspect` | 15 files |

### Methods To Remove From Mocks

The design spec says **remove the independent meta-session product concept**. These optional `RendererApi` methods are in `src/shared/project-session.ts:385–396` and implemented in mock factories:

| Method | Currently In Mock | File |
|--------|-----------------|------|
| `getMetaSessionBootstrapState` | Yes | `meta-session.test.ts:110`, `MetaSessionSurface.test.ts` (indirect via store), `ipc-bridge.test.ts` |
| `createMetaSession` | Yes | `meta-session.test.ts:174` |
| `setActiveMetaSession` | Yes | `meta-session.test.ts:182` |
| `archiveMetaSession` | Yes | `meta-session.test.ts:183` |
| `restoreMetaSession` | Yes | `meta-session.test.ts:184` |
| `listMetaSessionProposals` | Yes | `meta-session.test.ts:186` |
| `getMetaSessionProposal` | Yes | `meta-session.test.ts:187` |
| `approveMetaSessionProposal` | Yes | `meta-session.test.ts:190` |
| `rejectMetaSessionProposal` | Yes | `meta-session.test.ts:198` |
| `dispatchMetaSessionProposal` | Yes | `meta-session.test.ts:207` |
| `setMetaSessionInspectorTarget` | Yes | `meta-session.test.ts:185` |
| `onMetaSessionEvent` | Yes | `meta-session.test.ts:217` |

### `SessionSummary` Shape Changes

The spec adds `parentSessionId: string | null` and `createdBySessionId: string | null` to `SessionSummary`. Bootstrap state in all test files currently returns `sessions: []`, but any test that constructs `SessionSummary` literals will need these two fields added:

- `src/renderer/components/AppShell.test.ts:25–48` — `baseSession` literal
- `tests/e2e/frontend-store-projection.test.ts` — inline session literals
- `tests/e2e/app-bridge-guard.test.ts:29–48` — `mockCreatedSession` literal
- `src/renderer/app/App.test.ts:43–68` — `createSessionSummary()` factory
- `tests/e2e/ipc-push-harness.test.ts:49–71` — `createSessionSummary()` factory

### Risks / Unknowns

- [!] **`ipc-bridge.test.ts`** hardcodes `RENDERER_API_INVOKE_CHANNELS` (lines 63–90) — new channels must be added to this const array for the static test to pass.
- [!] **`ipc-bridge.test.ts:819`** (`RendererApi methods map to IPC_CHANNELS keys exactly`) is a structural test that will fail if new methods exist in the interface without matching IPC handlers.
- [?] The **Playwright MCP mock** (`.playwright-mcp/mock-vibecoding.js`) is a JS file used by the MCP server — not type-checked. It only stubs 7 methods and will silently ignore new session-tree calls.
- [?] Whether `session:create-child` replaces or extends `session:create` is not yet determined. Mocks for `createSession` currently exist in all 15 files.
- [?] `SessionNodeSnapshot` (containing `SessionSummary` + `SessionTreeMeta`) is a new read-model type that may need to be added to mock bootstrap state.

### Action Items for Mock Cleanup

1. Add stub for each new method (`sessionCreateChild`, `sessionPrompt`, `sessionDestroy`, `sessionInspect`) to all 15 mock factory functions.
2. Remove the 12 meta-session method stubs from `meta-session.test.ts` and `MetaSessionSurface.test.ts` mocks.
3. Update `RENDERER_API_INVOKE_CHANNELS` in `ipc-bridge.test.ts:63–90` to include new IPC channels.
4. Add `parentSessionId` and `createdBySessionId` to all inline `SessionSummary` literals.
5. Update `createPreloadApi` in `ipc-push-harness.test.ts` to include all current `RendererApi` methods (currently minimal).
6. Update `.playwright-mcp/mock-vibecoding.js` if it needs to stub session-tree methods for MCP-driven tests.

### Saved Report Path

`D:\Data\DEV\ultra_simple_panel\research\2026-05-29-session-tree-rendererapi-mocks-scope.md`