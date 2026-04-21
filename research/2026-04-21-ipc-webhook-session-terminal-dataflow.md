## Research Report: IPC, Webhook, Session Runtime & Terminal Data Flow

### Summary

The codebase has a well-tested request/response IPC bridge (7 invoke channels) and thorough unit coverage for session runtime + PTY lifecycle. However, the **push channels** (`terminal:data`, `session:event`) lack end-to-end integration testing from main→preload→renderer. The **webhook server is never wired into the main process** — it exists as a standalone module but no code connects `onEvent` callbacks to `SessionRuntimeController` or `ProjectSessionManager`. Terminal data flows PTY→controller→IPC→preload→xterm but this pipeline is only tested in fragments.

---

### Architecture: Current Data Flow Map

#### 1. IPC Architecture (Request/Response)

| Layer | File | Role |
|-------|------|------|
| Shared types | `src/shared/project-session.ts:99-109` | `RendererApi` contract — 9 methods (7 invoke + 2 push listeners) |
| Channel constants | `src/core/ipc-channels.ts:1-11` | 9 channel string constants |
| Preload bridge | `src/preload/index.ts:1-44` | `contextBridge.exposeInMainWorld('vibecoding', api)` — implements `RendererApi` |
| Main registration | `src/main/index.ts:52-122` | `ipcMain.handle()` for 7 invoke channels |
| FakeIpcBus | `tests/e2e/ipc-bridge.test.ts:14-34` | Test harness simulating ipcMain handle/invoke round-trip |

**Invoke channels (7):**
- `project:bootstrap` — returns `BootstrapState`
- `project:create` — creates project, returns `ProjectSummary`
- `project:set-active` — sets active project
- `session:create` — creates session AND spawns PTY via `startSessionRuntime()`
- `session:set-active` — sets active session
- `session:input` — writes to PTY via `PtyHost.write()`
- `session:resize` — resizes PTY via `PtyHost.resize()`

**Push channels (2):**
- `terminal:data` — main→renderer, terminal output chunks (`TerminalDataChunk`)
- `session:event` — main→renderer, session lifecycle events (`SessionStatusEvent`)

#### 2. Session Runtime Lifecycle

**Flow:** `session:create` IPC → `startSessionRuntime()` → provider.buildCommand → `PtyHost.start()` → `SessionRuntimeController` callbacks

| Component | File | Role |
|-----------|------|------|
| `SessionRuntimeManager` | `src/core/session-runtime.ts:4-9` | Interface: markStarting, markRunning, markExited, appendTerminalData |
| `startSessionRuntime()` | `src/core/session-runtime.ts:48-92` | Orchestrates: installSidecar → buildCommand → markStarting → ptyHost.start → markRunning |
| `SessionRuntimeController` | `src/main/session-runtime-controller.ts:7-44` | Implements `SessionRuntimeManager` — persists state + pushes IPC events to BrowserWindow |
| `PtyHost` | `src/core/pty-host.ts:10-49` | Manages node-pty instances, routes onData/onExit callbacks |

**Lifecycle sequence:**
1. `startSessionRuntime` calls `provider.installSidecar()`
2. `manager.markSessionStarting()` → persists `starting` + pushes `session:event` to renderer
3. `ptyHost.start()` → spawns process, wires `onData` → `appendTerminalData` and `onExit` → `markSessionExited`
4. `manager.markSessionRunning()` → persists `running` + externalSessionId + pushes `session:event`

#### 3. Webhook Server (Disconnected)

| Component | File | Role |
|-----------|------|------|
| `createLocalWebhookServer()` | `src/core/webhook-server.ts:35-96` | Express server with `/health` and `/events` endpoints |
| Event validation | `src/core/webhook-server.ts:18-33` | `isCanonicalSessionEvent()` — validates shape of incoming events |
| Secret auth | `src/core/webhook-server.ts:52-56` | `x-vibecoding-secret` header validation per session |

**[!] CRITICAL GAP:** The webhook server is **never instantiated or wired** in `src/main/index.ts`. The `ProjectSessionManager` is created with `webhookPort: null`. The `terminalWebhookPort` in `BootstrapState` is always null. There is no code that:
- Creates a `LocalWebhookServer`
- Routes webhook `onEvent` callbacks to `SessionRuntimeController`
- Maps `CanonicalSessionEvent` → `ProjectSessionManager.markSession*()` calls
- Passes the webhook port to providers for sidecar configuration

The webhook port 43127 is hardcoded in `session:create` handler and bootstrap recovery, but never actually listened on.

#### 4. Terminal Data Flow (PTY → xterm)

**Full pipeline:**
```
node-pty onData
  → session-runtime.ts:81 manager.appendTerminalData({ sessionId, data })
  → session-runtime-controller.ts:31 win.webContents.send('terminal:data', chunk)
  → preload/index.ts:34 ipcRenderer.on('terminal:data', handler)
  → TerminalViewport.vue:103 terminal.write(chunk.data)
```

**Input pipeline (reverse):**
```
xterm onData
  → TerminalViewport.vue:87 window.vibecoding.sendSessionInput(sessionId, data)
  → preload/index.ts:27 ipcRenderer.invoke('session:input', sessionId, data)
  → main/index.ts:117 ptyHost.write(sessionId, data)
  → pty-host.ts:33 terminal.write(data)
```

**Renderer subscription points:**
- `App.vue:69` — subscribes to `onSessionEvent` → calls `workspaceStore.updateSession()`
- `TerminalViewport.vue:102` — subscribes to `onTerminalData` → filters by sessionId → `terminal.write()`
- `TerminalViewport.vue:108` — subscribes to `onSessionEvent` → writes `[session exited]` marker

---

### Test Coverage: What Exists

#### Well-Covered Areas

| Area | Test File | What's Tested |
|------|-----------|---------------|
| IPC channel registration | `tests/e2e/ipc-bridge.test.ts` | FakeIpcBus round-trip for all 7 invoke channels, channel name consistency |
| SessionRuntimeController | `src/main/session-runtime-controller.test.ts` | markStarting/Running/Exited state persistence + IPC push, null/destroyed window guards |
| Session runtime logic | `src/core/session-runtime.test.ts` | Resume vs start command selection, canResume branches |
| Session runtime callbacks | `src/core/session-runtime-callbacks.test.ts` | onData→appendTerminalData, onExit→markSessionExited, call ordering, default values |
| PTY host | `src/core/pty-host.test.ts` | Spawn, write, resize boundaries, dispose, exit cleanup (mocked node-pty) |
| Webhook server | `src/core/webhook-server.test.ts` + `webhook-server-validation.test.ts` | Secret auth, event validation (all rejection branches), server lifecycle |
| Full runtime lifecycle | `tests/e2e/session-runtime-lifecycle.test.ts` | Real PTY with real processes through full lifecycle, state persistence, concurrent sessions |
| Store-backend sync | `tests/e2e/store-lifecycle-sync.test.ts` | Real PTY → manager events → Pinia store replay, disk consistency |
| App.vue bootstrap | `src/renderer/app/App.test.ts` | Bootstrap hydration, project/session creation, error handling |
| TerminalViewport | `src/renderer/components/TerminalViewport.test.ts` | Mount/xterm setup, overlay states, onTerminalData/onSessionEvent subscription |
| Bridge guards | `tests/e2e/app-bridge-guard.test.ts` | window.vibecoding undefined/partial/null scenarios |

#### Missing Test Coverage (Blind Spots)

**1. Push Channel End-to-End (terminal:data)**
- No test verifies data flowing from `PtyHost` → `SessionRuntimeController.appendTerminalData` → `win.webContents.send('terminal:data')` → FakeIpcBus push → renderer subscription → store update
- The `FakeIpcBus` only supports `handle`/`invoke` (request/response). It has no `send`/`on` mechanism for push channels
- `store-lifecycle-sync.test.ts` simulates push by manually calling `replayEventsToStore()` — it doesn't test the actual IPC push path

**2. Push Channel End-to-End (session:event)**
- Same gap as above — no test traces `SessionRuntimeController.pushSessionEvent` through to `App.vue`'s `onSessionEvent` subscription
- `App.test.ts` verifies that `onSessionEvent` is subscribed during mount but never fires a mock event and verifies store update

**3. Webhook → State Transitions**
- No test covers `CanonicalSessionEvent` → `ProjectSessionManager.markSession*()` or `updateSession()`
- The webhook server's `onEvent` callback is never wired to any state mutation in production code either
- There's no `handleWebhookEvent()` or similar function that maps event types (e.g., `session.started`, `session.exited`) to manager methods

**4. Terminal Input Round-Trip**
- No test verifies: xterm `onData` → `sendSessionInput` → `PtyHost.write()` → data arrives at PTY
- `sessionInput` handler in `ipc-bridge.test.ts` is a no-op stub (`bus.handle(IPC_CHANNELS.sessionInput, async () => { return })`)

**5. Multi-Window Push Broadcasting**
- `SessionRuntimeController` checks `win.isDestroyed()` but there's no test for multi-window scenarios or window recreation after crash

**6. Webhook Port Wiring in Main Process**
- No test (or production code) that the webhook server starts, binds to a port, and that port is exposed via `terminalWebhookPort` in BootstrapState

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Webhook server never instantiated in main | `src/main/index.ts` | No `createLocalWebhookServer` import or call |
| FakeIpcBus lacks push support | `tests/e2e/ipc-bridge.test.ts:14-34` | Only has `handle`/`invoke`, no `send`/`on` |
| SessionInput is stubbed in IPC test | `tests/e2e/ipc-bridge.test.ts:89-91` | `bus.handle(IPC_CHANNELS.sessionInput, async () => { return })` |
| App.vue onSessionEvent never tested with actual events | `src/renderer/app/App.test.ts` | No test fires a session event callback |
| TerminalViewport test doesn't verify data delivery to xterm | `src/renderer/components/TerminalViewport.test.ts:134-143` | Only checks subscription registration, not data flow |
| store-lifecycle-sync uses manual replay, not IPC push | `tests/e2e/store-lifecycle-sync.test.ts:94-101` | `replayEventsToStore()` directly calls `store.updateSession()` |

### Risk Points

- [!] **Webhook server is dead code** — built and tested in isolation, but never integrated. Any proposal to add webhook→state transitions requires first wiring it into main/index.ts
- [!] **Push channels have no integration test** — the FakeIpcBus gap means `terminal:data` and `session:event` are only tested at unit level (controller sends correctly) and component level (renderer subscribes correctly), but never across the boundary
- [?] **terminalWebhookPort always null** — the `BootstrapState` exposes it but no code sets it. If providers need the webhook port for sidecar config, it must be wired
- [!] **TerminalViewport session switch** — when `isRunning` watcher triggers `disposeTerminal()` + `setupTerminal()`, no test verifies terminal state is correctly reset and reconnected

### Recommendations

1. **Extend FakeIpcBus with push channel support** — add `send(channel, data)` / `on(channel, handler)` methods to enable end-to-end push channel tests
2. **Wire webhook server into main process** — create `createLocalWebhookServer` with `onEvent` that routes to `SessionRuntimeController` or `ProjectSessionManager`, then test the integration
3. **Add push channel E2E test** — test that `appendTerminalData` and `pushSessionEvent` flow through to renderer subscriptions
4. **Test App.vue session event handling** — fire mock `onSessionEvent` callbacks and verify store state changes
5. **Test terminal data delivery** — verify that `onTerminalData` callback data reaches xterm's `write()` method
6. **Wire terminalWebhookPort** — start webhook server, pass port to ProjectSessionManager, expose via BootstrapState

### Open Questions

- Should the webhook server use the same port for all sessions, or per-session ports?
- Should `CanonicalSessionEvent.payload` be mapped 1:1 to session state, or is there a transformation layer needed?
- Is the intent for webhooks to supplement or replace the PTY exit callback for session state updates?
- Should `onTerminalData` in the renderer accumulate a buffer for reconnection scenarios?
