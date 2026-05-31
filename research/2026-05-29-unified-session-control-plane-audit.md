---
date: 2026-05-29
topic: main-process IPC control-plane audit for unified SessionControlServer cutover
status: completed
mode: context-gathering
sources: 9
---

## Context Report: Unified SessionControlServer Cutover — Control-Plane Audit

### Why This Was Gathered
To implement the cutover from the current split (meta-session control server + work-session IPC) to a unified `SessionControlServer`, remove `activeMetaSessionId` from the port-file dependency, and wire a new `SessionGraphEvent` IPC push channel. This audit maps every touchpoint that the cutover must change.

### Summary
The current architecture has two parallel control planes: work sessions flow through `SessionRuntimeController` → `SessionEventBridge` → IPC push channels, while meta sessions flow through `MetaSessionManager` → `createMetaSessionControlServer` (HTTP routes on the shared webhook Express app) → `metaSession:*` IPC channels. The unified `SessionControlServer` (`src/core/session-control-server.ts`) **does not exist yet** and must be created. The port file at `~/.stoa/ctl.json` carries `activeMetaSessionId` which must be removed as a dependency. No `sessionGraphEvent` IPC channel exists yet — it must be added to `IPC_CHANNELS`, registered in preload, and wired in `SessionRuntimeController`.

### Key Findings

#### 1. No unified SessionControlServer exists
- `src/core/session-control-server.ts` — **file does not exist**
- `src/core/session-control-server.test.ts` — **file does not exist**
- Only `src/core/meta-session-control-server.ts` (HTTP control server) exists

#### 2. Current control-plane is split across two worlds

**Work-session path:**
- IPC channels: `session:*` (create, set-active, archive, restore, restart, resize, input, binary-input, terminal-replay, list-archived, regenerate-title, event)
- Controller: `SessionRuntimeController` (`src/main/session-runtime-controller.ts`) implements `SessionRuntimeManager` — pushes `session:event` and `terminal:data` to renderer via `webContents.send`
- Bridge: `SessionEventBridge` (`src/main/session-event-bridge.ts`) — receives webhook events, converts to patches, calls `compositeRuntimeController.applyProviderStatePatch`
- State: `ProjectSessionManager` (`@core/project-session-manager`)

**Meta-session path:**
- IPC channels: `meta-session:*` (bootstrap, create, set-active, archive, restore, event, proposal-*, inspector-set-target)
- HTTP control server: `createMetaSessionControlServer` — mounted inside `SessionEventBridge` via `configureServerApp` callback (shares the webhook Express app)
- Push: `pushMetaSessionEvent()` in `index.ts` sends `IPC_CHANNELS.metaSessionEvent` to renderer
- State: `MetaSessionManager` (`@core/meta-session-manager`)

#### 3. The compositeRuntimeController routes by session ownership
- Defined inline in `index.ts` lines 612–636
- If `metaSessionManager.hasSession(patch.sessionId)` → routes to `metaSessionManager.updateSession` + `pushMetaSessionEvent`
- Otherwise → routes to `activeRuntimeController.applyProviderStatePatch`
- This bifurcation is the primary unification target

#### 4. Port-file activeMetaSessionId dependency
- `PortFileData` interface in `stoa-ctl-port-file.ts:6-12` includes `activeMetaSessionId: string | null`
- Written in `refreshCtlPortFile()` at `index.ts:747-756` — reads `metaSessionManager.snapshot().activeMetaSessionId`
- Called after: `setActiveMetaSessionWithEvent`, `archiveMetaSessionWithRuntime`, and initial startup
- Read by CLI tooling (`stoa-ctl`) to know which meta session to target
- The port-file test (`stoa-ctl-port-file.test.ts`) validates `activeMetaSessionId` field parsing (lines 120-127)

#### 5. IPC_CHANNELS has no sessionGraphEvent channel
- Current push channels for session state: `session:event`, `metaSession:event`, `terminal:data`
- No unified graph event channel exists
- Observability push channels exist: `observability:session-presence-changed`, `observability:project-observability-changed`, `observability:app-observability-changed`

#### 6. SessionRuntimeController push mechanism
- `pushSessionEvent()` (line 124) sends `IPC_CHANNELS.sessionEvent` with `{ session }` payload
- `pushObservabilitySnapshots()` (line 138) sends three observability channels
- `flushTerminalBatch()` (line 96) sends `IPC_CHANNELS.terminalData`
- All go through `getWindow().webContents.send()`
- The constructor takes `getWindow: () => RuntimeWindow | null` — pure DI, no Electron coupling

#### 7. Meta-session control server auth model
- Auth middleware checks `x-stoa-session-id` header + session existence, OR `x-stoa-secret` matching `ctlSecret`
- `ctlSecret` generated at startup in `index.ts:637` before bridge starts
- Both auth paths must be preserved in the unified server

#### 8. Config guard test coverage
- `main-config-guard.test.ts` validates:
  - All `RendererApi` methods have `ipcMain.handle` registrations (lines 244-306)
  - Send-only methods have `ipcMain.on` registrations (lines 309-324)
  - Preload channel names match `IPC_CHANNELS` constants (lines 326-338)
  - Push channel listeners in preload (lines 579-626)
  - Method-to-channel name mapping (lines 496-550)
- **Adding new IPC channels requires updating this test's known-methods lists**

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| SessionControlServer does not exist | Filesystem check | `src/core/session-control-server.ts` — not found |
| Meta-session control server routes and auth | `src/core/meta-session-control-server.ts` | lines 29-96, 156-669 |
| compositeRuntimeController bifurcation | `src/main/index.ts` | lines 612-636 |
| Port-file carries activeMetaSessionId | `src/core/stoa-ctl-port-file.ts` | lines 7-12 |
| refreshCtlPortFile reads activeMetaSessionId | `src/main/index.ts` | lines 747-756 |
| SessionEventBridge configureServerApp callback | `src/main/session-event-bridge.ts` | lines 50, 107, 140-141 |
| SessionRuntimeController push mechanism | `src/main/session-runtime-controller.ts` | lines 124-166 |
| IPC_CHANNELS full list (95 channels) | `src/core/ipc-channels.ts` | lines 1-95 |
| pushMetaSessionEvent sends to renderer | `src/main/index.ts` | lines 360-367 |
| Config guard validates all IPC registrations | `tests/e2e/main-config-guard.test.ts` | lines 244-550, 579-626 |
| Port-file test validates activeMetaSessionId field | `src/core/stoa-ctl-port-file.test.ts` | lines 120-127 |
| Meta-session control server test covers all routes | `src/core/meta-session-control-server.test.ts` | lines 158-1078 |
| ctlSecret generated before bridge start | `src/main/index.ts` | lines 637-639 |

### Risks / Unknowns

- [!] **Breaking change surface is large**: The `meta-session:*` IPC channels, the `PortFileData.activeMetaSessionId` field, and the `compositeRuntimeController` bifurcation are all used by renderer, preload, CLI tooling, and tests. All must be updated atomically.
- [!] **Config guard test is brittle**: It maintains explicit method-to-channel maps and known-methods lists. Any new channel must update these lists or the guard fails.
- [?] **CLI tooling dependency on activeMetaSessionId**: `stoa-ctl` reads `~/.stoa/ctl.json` to find the active meta session. If `activeMetaSessionId` is removed from the port file, CLI must find it another way (e.g., HTTP endpoint or separate state).
- [?] **SessionGraphEvent payload shape**: Not specified in the research scope. Must be designed — likely needs to carry both work-session and meta-session graph mutations (add/remove/update node, edge changes).
- [?] **Shared Express app lifecycle**: `createMetaSessionControlServer` receives the Express app from `SessionEventBridge` via `configureServerApp`. The unified server must preserve this mount-on-existing-app pattern or break the bridge lifecycle.

### Cutover Dependency Map

```
What must be created:
  src/core/session-control-server.ts        — unified SessionControlServer
  src/core/session-control-server.test.ts   — tests for unified server

What must be modified:
  src/core/ipc-channels.ts                  — add sessionGraphEvent channel
  src/main/index.ts                         — replace compositeRuntimeController + metaSessionControlServer wiring
  src/main/session-runtime-controller.ts    — add pushSessionGraphEvent()
  src/main/session-event-bridge.ts          — update configureServerApp to use unified server
  src/core/stoa-ctl-port-file.ts            — remove activeMetaSessionId from PortFileData
  src/preload/index.ts                      — add sessionGraphEvent listener
  src/shared/project-session.ts             — add RendererApi method if needed

Tests that must be updated:
  src/core/stoa-ctl-port-file.test.ts       — remove activeMetaSessionId assertions
  tests/e2e/main-config-guard.test.ts       — add new channel to known-methods lists
  src/core/meta-session-control-server.test.ts — may need migration or deprecation
```
