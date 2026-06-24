---
date: 2026-06-19
topic: Backend health contract (Mobile UI V1, Implementation Plan §1) — bounded context
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Backend Health Contract (Mobile UI V1 §1)

### Why This Was Gathered

`docs/superpowers/specs/2026-06-19-mobile-ui-v1-design.md` Implementation Plan §1 ("Backend health contract") requires:

1. Add a global backend health API.
2. Expose it through IPC / preload renderer API.
3. Add core tests for health success / failure.
4. Add renderer tests for health state transitions.

The spec defines three transport/backend health states — `Connected` / `Reconnecting` / `Offline` (spec lines 499–503, 528–545) — and is explicit that this is **transport/backend health, separate from session business state** (spec lines 495–509, Non-Goal line 41: "Health is global backend health only"). This report maps the exact seams an implementer must touch and the guard tests that will break if they are missed.

### Summary

There is **no existing renderer-facing backend-health contract**. The closest existing primitive is the main-process `getServerInfo()` surface (`server:get-info` IPC → `getStoaServerWebInfo()`, which probes the unauthenticated `/api/v1/discovery`). The Stoa Server already exposes an **authenticated `GET /ctl/health`** returning `{ status: 'healthy', uptime, db, timestamp }`, and the spawner already polls it (`waitForHealth`). The natural implementation shape is: add a `BackendHealth` type + `getBackendHealth()` to `RendererApi`; implement it in `StoaClientPreloadAdapter` over HTTP (reusing the `StoaClient.get` envelope) so it works identically on desktop and web; add a native preload method + `serverGetHealth` IPC constant only if a main-proxied probe is also wanted. **Three static guard tests have hard-coded method/constant counts and channel maps that MUST be updated in lockstep**, or the pipeline will fail.

### Key Findings

- **No renderer health contract exists today.** Grep for `BackendHealth|getBackendHealth|connectionHealth|ConnectionHealth|useConnection|healthStore|useHealth` returns nothing in `src/renderer`. The only reconnect logic is internal WS transport: `src/main/stoa-runtime-client.ts` (main→SR socket) and `src/renderer/lib/stoa-client.ts` (renderer→SR socket). Neither exposes a state machine to components.
- **Do NOT confuse with observability health.** `ObservabilityHealth = 'healthy' | 'lost'` (`src/shared/observability.ts:37`) backs `SessionPresenceSnapshot.health`, `ProjectObservabilitySnapshot.overallHealth`, and `AppObservabilitySnapshot.providerHealthSummary` — these are **session/provider** health, exactly what the spec says backend health is *not* (spec lines 505–509, 518–526).
- **Server already has a health probe to reuse: `GET /ctl/health`** (`stoa-server/src/routes/health.ts:11-26`), authenticated via Bearer token, returns `{ ok, data: { status: 'healthy', uptime, db: 'connected', timestamp }, meta }`. Tested in `stoa-server/src/routes/routes.test.ts:65-106` (200 authed, 401 unauthed, 401 bad token).
- **Discovery endpoint (unauthenticated) is the existing availability probe.** `GET /api/v1/discovery` (`stoa-server/src/routes/discovery.ts:21-38`) returns `{ name, version, port, uptime, webClient, lanMode }`; auth middleware skips it (`stoa-server/src/middleware/auth.ts:27-28`). `getStoaServerWebInfo()` already calls it with a 2 s timeout (`src/main/stoa-server-web-info.ts:44-64`).
- **`RendererApi.getServerInfo()`** (`src/shared/project-session.ts:706`) is the current "is the backend up" method on the renderer contract. It returns `{ available, port, url, token }`. A new `getBackendHealth()` should sit alongside it.
- **`window.stoa` composition differs by shell** but both shells end with a `StoaClientPreloadAdapter` as the `RendererApi`:
  - Desktop (`src/renderer/bootstrap-electron.ts:30-54`): builds `StoaClientPreloadAdapter`, then `Object.assign(adapter, nativeBridge)` to mix in native (`window.stoaElectron`) methods, then `window.stoa = adapter`. So a method added to `StoaClientPreloadAdapter` is present on desktop too.
  - Web (`src/renderer/bootstrap-web.ts:22-43`): `window.stoa = new StoaClientPreloadAdapter(client)` directly — no native bridge. **Any desktop-only native probe would be absent on web**, so the health call should live in the HTTP adapter for parity.
- **IPC constant + preload pattern is uniform.** `src/core/ipc-channels.ts` is a single `as const` object; preload (`src/preload/index.ts:21-87`) builds an `electronApi` object and exposes it as `window.stoaElectron`; main (`src/main/index.ts`) registers `ipcMain.handle(IPC_CHANNELS.X, …)`. The existing `serverGetInfo` trio is the template: constant `serverGetInfo: 'server:get-info'` (`ipc-channels.ts:85`), preload `getServerInfo` (`preload/index.ts:23-25`), handler `getStoaServerWebInfo(srSpawner)` (`main/index.ts:1983-1985`).
- **`StoaClient` already does authenticated HTTP with the `ApiResponse<T>` envelope.** `src/renderer/lib/stoa-client.ts:96-141` (`request`/`get`/`post`). A health call = `client.get<HealthPayload>('/ctl/health')` (or a new `/api/v1/health`), mirroring how `StoaClientPreloadAdapter.getServerInfo` calls `/api/v1/discovery` (`stoa-client-preload-adapter.ts:639-652`).

### Implementation Seam Map (exact insertion points)

| Layer | File | What to add | Anchor |
|---|---|---|---|
| Shared type | `src/shared/project-session.ts` | `BackendHealth` type (state: Connected/Reconnecting/Offline + timestamp) and `getBackendHealth: () => Promise<BackendHealth>` on `RendererApi` (and `ElectronRendererNativeApi` if a native probe is added) | `RendererApi` ends `project-session.ts:706-707` |
| IPC constant | `src/core/ipc-channels.ts` | `serverGetHealth: 'server:get-health'` (only if main-proxied probe is wanted) | near `serverGetInfo` `ipc-channels.ts:85` |
| Preload (native) | `src/preload/index.ts` | `async getBackendHealth()` invoking `IPC_CHANNELS.serverGetHealth` (only if native probe wanted) | `electronApi` block `preload/index.ts:21-85`; note it's exposed as `stoaElectron` `preload/index.ts:87` |
| Main handler | `src/main/index.ts` | `ipcMain.handle(IPC_CHANNELS.serverGetHealth, …)` if native probe; or rely on adapter HTTP | template `serverGetInfo` `main/index.ts:1983-1985`; main-side probe helper `getStoaServerWebInfo` `src/main/stoa-server-web-info.ts` |
| Renderer adapter | `src/renderer/lib/stoa-client-preload-adapter.ts` | `getBackendHealth()` → `this.client.get<BackendHealth>('/ctl/health')` (works desktop + web) | `getServerInfo` `stoa-client-preload-adapter.ts:639-652` |
| Renderer client | `src/renderer/lib/stoa-client.ts` | nothing required; reuse `get<T>` `stoa-client.ts:127-129` |
| Test fixtures | `src/shared/test-fixtures.ts` | add `getBackendHealth` mock to `createRendererApiMock` (else it stops fully satisfying `RendererApi`) | `createRendererApiMock` returns `getServerInfo` at `test-fixtures.ts:208` |

### Guard Tests That WILL Break (update in lockstep — these are the hard constraints)

1. **`tests/e2e/main-config-guard.test.ts`**
   - `'preload api object implements all Electron native invoke methods'` (`:389-439`): asserts `preloadSource.match(/async\s+\w+\s*\(/g).length === knownInvokeMethods.length` (currently 20, `:419-423`). Adding `async getBackendHealth()` to preload **without** also pushing it into `knownInvokeMethods` (`:390-410`) fails this exact-count check.
   - `'every Electron native invoke method has a corresponding ipcMain.handle registration'` (`:251-306`): add `'getBackendHealth'` to `rendererApiMethods` (`:252-272`) and a `['getBackendHealth', 'serverGetHealth']` entry to `channelToConstant` (`:273-293`).
   - `'preload uses correct channel name for each method'` (`:441-467`): add `expect(invMap.get('getBackendHealth')).toBe('server:get-health')`.
   - (If a new constant is added) the IPC_CHANNELS expectation blocks at `:476-492`, `:494-509`, `:511-529` may need a sibling assertion.
   - Note: there is an explicit "must NOT expose" list `stoaRuntimeAdapterMethods` (`:425-431`); `getBackendHealth` is not in it, so it is allowed on the native preload, but the parity question (web vs desktop) above still governs where the real logic lives.

2. **`tests/e2e/ipc-bridge.test.ts`**
   - `RENDERER_API_INVOKE_CHANNELS` (`:68-84`) + `'no extra channels beyond invoke RendererApi are exposed to preload'` (`:326-336`): the latter asserts `bus.getRegisteredChannels().length === RENDERER_API_INVOKE_CHANNELS.length`. If health becomes a real `ipcMain.handle` channel, it must be added to `RENDERER_API_INVOKE_CHANNELS` or this count assertion breaks.
   - `'RendererApi methods map to IPC_CHANNELS keys exactly'` (`:671-702`): asserts `Object.keys(...).toHaveLength(21)` (`:697`). Adding `getBackendHealth` to the map without bumping to 22 fails it.
   - `createPreloadApi()` (`:161-194`) and `registerMainHandlers()` (`:196-301`): the test-local fakes that implement the `RendererApi` subset — add a `getBackendHealth` stub + handler registration if health is modeled as an invoke channel.

3. **Stoa Server side** (if a new `/api/v1/health` is preferred over reusing `/ctl/health`): mount it in `stoa-server/src/app.ts:66-67,97-98`, add a route file under `stoa-server/src/routes/`, and a test mirroring `stoa-server/src/routes/routes.test.ts:65-106`. Reusing the existing authenticated `GET /ctl/health` avoids all of this.

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Health contract requirement + states Connected/Reconnecting/Offline + global-only | spec | `docs/superpowers/specs/2026-06-19-mobile-ui-v1-design.md:491-556`, Non-Goal `:41` |
| Implementation Plan §1 backend health contract | spec | `docs/superpowers/specs/2026-06-19-mobile-ui-v1-design.md:674-679` |
| IPC constant object (single source) | `src/core/ipc-channels.ts` | `ipc-channels.ts:1-88`; `serverGetInfo` at `:85` |
| `RendererApi` interface incl. `getServerInfo` return type | `src/shared/project-session.ts` | `project-session.ts:606-707`; `getServerInfo` `:706` |
| `ElectronRendererNativeApi` (what native preload implements) | `src/shared/project-session.ts` | `project-session.ts:709-731` |
| `window.stoa` / `window.stoaElectron` global declaration | `src/shared/index.d.ts` | `index.d.ts:3-8` |
| Preload exposes `stoaElectron`; `getServerInfo` invoke pattern | `src/preload/index.ts` | `preload/index.ts:21-87`; `getServerInfo` `:23-25`; expose `:87` |
| `serverGetInfo` main handler → `getStoaServerWebInfo(srSpawner)` | `src/main/index.ts` | `main/index.ts:1983-1985` |
| Main-side discovery probe (2 s timeout, `/api/v1/discovery`) | `src/main/stoa-server-web-info.ts` | `stoa-server-web-info.ts:33-65` |
| Server `GET /ctl/health` shape + auth required | `stoa-server/src/routes/health.ts` | `health.ts:11-26` |
| Server `/ctl/health` tests (200/401/401) | `stoa-server/src/routes/routes.test.ts` | `routes.test.ts:65-106` |
| Auth middleware skips `/api/v1/discovery` only; `/ctl/health` needs Bearer | `stoa-server/src/middleware/auth.ts` | `auth.ts:26-45` |
| Server `/api/v1/discovery` shape (unauthenticated) | `stoa-server/src/routes/discovery.ts` | `discovery.ts:21-38` |
| Spawner polls `/ctl/health` (existing backend-health precedent) | `src/main/stoa-server-spawner.ts` | `waitForHealth` `:120-148`; call site `:203-211` |
| `StoaClient` authenticated HTTP + `ApiResponse<T>` envelope | `src/renderer/lib/stoa-client.ts` | `request` `:96-125`; `get` `:127-129` |
| Adapter `getServerInfo` → `/api/v1/discovery` (template for new HTTP method) | `src/renderer/lib/stoa-client-preload-adapter.ts` | `:639-652` |
| Desktop composes `window.stoa` = adapter + native (Object.assign) | `src/renderer/bootstrap-electron.ts` | `:30-54`; assign `:47`, set `:51` |
| Web composes `window.stoa` = adapter only (no native bridge) | `src/renderer/bootstrap-web.ts` | `:22-43` |
| `ObservabilityHealth` = session/provider health (NOT transport health) | `src/shared/observability.ts` | `:37,80,93,110` |
| No renderer connection-health composable/store exists | grep (src/renderer) | `useConnection|healthStore|ConnectionHealth|getBackendHealth` → no matches; reconnect only in `stoa-client.ts:180-263` and main `stoa-runtime-client.ts` |
| Test fixture mock must gain `getBackendHealth` to satisfy `RendererApi` | `src/shared/test-fixtures.ts` | `createRendererApiMock` `:65-212`; `getServerInfo` `:208` |
| Guard test exact-count assertion on preload invoke methods | `tests/e2e/main-config-guard.test.ts` | `:389-439` (count `:419-423`) |
| Guard test method↔constant↔channel maps | `tests/e2e/main-config-guard.test.ts` | `:251-306`, `:441-467` |
| IPC-bridge channel-list count + method-count assertions | `tests/e2e/ipc-bridge.test.ts` | `RENDERER_API_INVOKE_CHANNELS :68-84`; count `:326-336`; method count `:697` |
| IPC-bridge fake preload + handler registration helpers | `tests/e2e/ipc-bridge.test.ts` | `createPreloadApi :161-194`; `registerMainHandlers :196-301` |

### Risks / Unknowns

- [!] **Count-based guard tests are the highest-likelihood break.** `main-config-guard` (`preload async-method count === 20`) and `ipc-bridge` (`RendererApi method count === 21`, `registered-channel count === RENDERER_API_INVOKE_CHANNELS.length`) will fail on any additive change unless updated together. These are static-analysis tests that read source as text, so they cannot "discover" the new member automatically.
- [!] **Web/desktop parity.** A health method placed only on the native preload (`window.stoaElectron`) would be `undefined` in the web shell (`bootstrap-web.ts` has no native bridge). The spec requires mobile health on the same renderer; placing the real probe in `StoaClientPreloadAdapter` (HTTP) gives both shells parity. The native preload method should only mirror it if a main-proxied probe is explicitly desired.
- [!] **Polling policy lives in the renderer, not the contract.** Spec polling rules (5 s foreground / 2 s retry / 15 s→Offline, visibility gating) are renderer-side state-machine concerns (spec `:528-545`), **not** part of the IPC/type contract in §1. The contract only needs to return raw health; the state machine is a later mobile-shell concern. Keep §1 scope to the API + success/failure tests.
- [?] **Which server endpoint to target.** Reusing the existing authenticated `GET /ctl/health` requires no server change and already returns a usable `status: 'healthy'`. The alternative (new `/api/v1/health`) is cleaner REST-wise but adds server route + test work. The spec does not mandate either; recommendation is to reuse `/ctl/health` unless the team wants a versioned REST surface.
- [?] **Failure semantics over HTTP.** `StoaClient.request` throws `StoaClientError` on non-`ok`/error envelopes (`stoa-client.ts:115-122`); a network failure (fetch rejects) propagates as a thrown error. The contract should define whether `getBackendHealth()` resolves to an `Offline`-state object on failure or throws — the renderer state machine (later step) is simpler if the contract resolves to a state object rather than throwing. Confirm in the type design.
