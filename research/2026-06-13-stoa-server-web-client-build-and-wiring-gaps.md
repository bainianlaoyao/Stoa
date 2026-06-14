---
date: 2026-06-13
topic: stoa-server web-client build and renderer wiring — gaps blocking web E2E
status: completed
mode: context-gathering
sources: 22
---

## Context Report: Web-Client Build & Renderer Wiring — Gaps Blocking Web E2E Coverage

### Why This Was Gathered

Stoa Server now has a web build pipeline (`vite.web.config.ts`) and a full client adapter (`StoaClientPreloadAdapter`), but no web E2E test harness exists. This report identifies the concrete gaps that must be closed before `npx playwright test --project=web` can pass.

### Summary

The **build and wiring are structurally complete** — `vite.web.config.ts` produces a SPA bundle, `bootstrap-web.ts` bridges into the renderer, and `StoaClientPreloadAdapter` maps every `RendererApi` method to REST/WS. However, **zero web E2E test infrastructure exists**: `playwright.config.ts` is Electron-only, no `webServer` config, no `tests/e2e-web/` directory, no `test:e2e:web` script, no web-compatible fixture library. Additionally, several runtime risks (CSP headers, missing server routes, desktop-only stubs, token bootstrap UX) will cause real browser runs to fail before any test logic executes.

### Key Findings

#### 1. Build Pipeline — Complete ✅

`vite.web.config.ts` builds `src/renderer/index.html` → `stoa-server/dist/web/`, shares aliases and plugins with `electron.vite.config.ts` via `vite.renderer.shared.ts`, and defines `VITE_USE_STOA_CLIENT=1`.

| Component | Status | Evidence |
|-----------|--------|----------|
| Vite web config | ✅ Works | `vite.web.config.ts:1-21` — root, aliases, plugins, `outDir: stoa-server/dist/web` |
| Shared renderer config | ✅ Works | `vite.renderer.shared.ts:1-22` — vue, tailwindcss, VueI18n plugins, `@renderer` alias |
| Build script | ✅ Exists | `package.json` — `"build:web": "vite build --config vite.web.config.ts"` |
| Static file serving | ✅ Works | `stoa-server/src/routes/static.ts:1-19` — serves from `dist/web/`, SPA fallback |
| Static mount order | ✅ Tested | `stoa-server/src/routes/static-mount-order.test.ts` — verifies API routes take priority |
| Web client path resolution | ✅ Works | `stoa-server/src/shared/web-client-path.ts:1-21` — 3 candidate roots, `isWebClientAvailable()` |

#### 2. Renderer Wiring — Complete ✅

| Component | Status | Evidence |
|-----------|--------|----------|
| Web bootstrap | ✅ Works | `src/renderer/bootstrap-web.ts:1-43` — reads `?token=` from URL, creates `StoaClient`, wraps in `StoaClientPreloadAdapter`, sets `window.stoa` |
| Feature flag gate | ✅ Works | `stoa-store-plugin.ts:92-95` — `VITE_USE_STOA_CLIENT === '1'` |
| Entry point branching | ✅ Works | `src/renderer/main.ts:9-10` — `if (!window.stoa) bootstrapWebRenderer()` |
| Pinia plugin injection | ✅ Works | `stoa-store-plugin.ts:100-104` — `$stoaClient` injected into every store |
| RendererApi fallback | ✅ Works | `stoa-store-plugin.ts:52-69` — prefers `rendererApiInstance` in client mode, else `window.stoa` |
| Unit test coverage | ✅ Good | `bootstrap-web.test.ts`, `stoa-client.test.ts`, `stoa-client-preload-adapter.test.ts` |

#### 3. StoaClient — REST/WS Client — Complete ✅

| Component | Status | Evidence |
|-----------|--------|----------|
| HTTP client | ✅ Works | `stoa-client.ts:96-125` — fetch with Bearer auth, `ApiResponse<T>` envelope |
| WebSocket client | ✅ Works | `stoa-client.ts:145-191` — `connectWs()`, reconnect with exponential backoff, event buffer/flush |
| WS subscribe/unsubscribe | ✅ Works | `stoa-client.ts:215-237` — sends `subscribe`/`unsubscribe` messages to server |
| Binary input | ✅ Works | `stoa-client.ts:258-269` — `sendBinaryInput()` via WS base64 |
| Adapter completeness | ✅ Full | `stoa-client-preload-adapter.ts:1-650` — implements full `RendererApi` including git, fs, meta-sessions, sidebar |

#### 4. Server Wiring — Complete ✅

| Component | Status | Evidence |
|-----------|--------|----------|
| Hono app assembly | ✅ Works | `stoa-server/src/app.ts:49-84` — mounts all routes, `webClient` option mounts static routes last |
| Server entry point | ✅ Works | `stoa-server/src/index.ts:62-253` — creates deps, `--web` flag enables web client |
| WS transport | ✅ Works | `stoa-server/src/ws/transport.ts` — hand-rolled RFC 6455, text/close/ping/pong |
| WS role router | ✅ Works | `stoa-server/src/ws/role-router.ts` — `role=runtime` vs `role=web`, token auth |
| CORS enabled | ✅ Works | `stoa-server/src/index.ts:176` — `cors: true` when `--web` flag is set |

---

### Gaps & Risks Blocking Web E2E

#### GAP-1: No Playwright Web Project (BLOCKER)

`playwright.config.ts:1-19` is a single unnamed project with no `projects:[]`, no `webServer:`, no `use.baseURL`. All existing Playwright tests (`tests/e2e-playwright/`, `tests/generated/playwright/`) use `_electron` APIs exclusively.

**Required:**
- Add `projects: [{ name: 'electron', ... }, { name: 'web', use: { baseURL: 'http://localhost:PORT' }, webServer: { command: '...', port: PORT } }]`
- Add `test:e2e:web` script to `package.json`
- Run `npx playwright install chromium` before web tests

| Source | Location |
|--------|----------|
| Playwright config is Electron-only | `playwright.config.ts:1-19` |
| No web test scripts | `package.json` scripts section |
| Prior audit confirms | `research/2026-06-13-playwright-browser-test-migration-progress-audit.md:25-28` |

#### GAP-2: No Web Test Fixture Library (BLOCKER)

`tests/e2e-playwright/fixtures/electron-app.ts` provides `launchElectronApp()`, `getMainE2EDebugState()`, `readTerminalBuffer()`, etc. No equivalent web fixture exists.

**Required:**
- Create `tests/e2e-web/fixtures/web-app.ts` with:
  - `launchWebApp()` — spawns stoa-server with `--web`, gets `Page` from Playwright, navigates to `http://localhost:PORT?token=TOKEN`
  - Seed data helpers (create project/session via REST before page load)
  - Cleanup on teardown

| Source | Location |
|--------|----------|
| Electron fixture | `tests/e2e-playwright/fixtures/electron-app.ts:1-309` |
| No web fixture directory | `tests/e2e-web/` does not exist |

#### GAP-3: CSP Header Blocks WS in Production (RISK)

`src/renderer/index.html:7-8` defines a restrictive CSP: `connect-src 'self' http: https: ws: wss:`. This should allow WS connections. However, `stoa-server/src/routes/static.ts` serves via Hono's `serveStatic` — the CSP is embedded in the HTML, not a server header. If the server ever adds a CSP response header that's more restrictive, WS will break.

**Current state: safe** — CSP is in the HTML file and permits `ws: wss:`. But worth noting as a regression risk.

| Source | Location |
|--------|----------|
| CSP allows ws/wss | `src/renderer/index.html:7` |

#### GAP-4: Token Bootstrap UX (RISK)

`bootstrap-web.ts:11-19` reads `?token=` from the URL. If missing, throws immediately. For E2E tests this is fine (tests inject the token), but there's no discovery URL mechanism — the test must know the token before navigating. The server uses `STOA_AUTH_TOKEN` env var or defaults to `'stoa-dev-token'` (`stoa-server/src/index.ts:192`).

**Mitigation:** Tests can set `STOA_AUTH_TOKEN` env and inject the known token. The discovery endpoint (`/api/v1/discovery`) does NOT expose the token — it returns `{ webClient: boolean }` but not the auth token.

| Source | Location |
|--------|----------|
| Token required in URL | `src/renderer/bootstrap-web.ts:11-19` |
| Server token default | `stoa-server/src/index.ts:192` |
| Discovery does not expose token | `stoa-server/src/routes/discovery.ts` |

#### GAP-5: Desktop-Only Stubs May Confuse E2E Assertions (RISK)

`StoaClientPreloadAdapter` stubs many methods as no-ops with `console.warn`:
- `openWorkspace()` — desktop only
- `pickFolder()` / `pickFile()` — desktop only
- `minimizeWindow()` / `maximizeWindow()` / `closeWindow()` / `isWindowMaximized()` — desktop only
- `getUpdateState()` / `checkForUpdates()` / `downloadUpdate()` / `quitAndInstallUpdate()` / `dismissUpdate()` / `onUpdateState()` — desktop only, returns idle state
- `fsOpenFile()` / `shellShowItemInFolder()` — desktop only

Web E2E tests must NOT assert update-related UI, window management UI, or workspace launcher behavior. Tests that verify `UpdatePrompt` visibility or `openWorkspace` responses need web-specific skip logic.

| Source | Location |
|--------|----------|
| Desktop stubs | `stoa-client-preload-adapter.ts:89-93, 259-267, 291-310, 313-365, 467-469, 480-483` |
| App.vue calls update store | `src/renderer/app/App.vue:265-269` — `updateStore.refresh()` and `settingsStore.loadSettings()` |

#### GAP-6: Observability Stubs Return Empty Data (RISK)

`stoa-server/src/index.ts:105-128` stubs observability functions:
- `getSessionPresence` → always `null`
- `getProjectObservability` → always `null`
- `getAppObservability` → returns zeroed snapshot
- `listSessionEvents` → always empty

Web E2E tests that verify session presence indicators, project health badges, or observability timelines will see empty/null data and fail.

| Source | Location |
|--------|----------|
| Observability stubs | `stoa-server/src/index.ts:105-128` |

#### GAP-7: onSessionEvent Is a No-Op in Web Mode (RISK)

`StoaClientPreloadAdapter.onSessionEvent()` at line 173-176 is explicitly a no-op:
```typescript
onSessionEvent(_callback: (event: SessionSummaryEvent) => void): () => void {
  return () => {}
}
```

The web client uses `onSessionGraphEvent` instead (via WS `session:graph` subscription). This is correct — App.vue checks `if (stoa.onSessionGraphEvent)` first — but any E2E test that only listens for `onSessionEvent` will never receive events.

| Source | Location |
|--------|----------|
| onSessionEvent no-op | `stoa-client-preload-adapter.ts:173-176` |
| App.vue graph event preference | `src/renderer/app/App.vue:237-251` |

#### GAP-8: Settings Store detectAndSetVscode in Web Mode (MINOR RISK)

`src/renderer/app/App.vue:274` calls `settingsStore.detectAndSetVscode()` on mount. The web adapter's `detectVscode()` hits `/api/v1/settings/detect/vscode` — the server may or may not implement this route. If it 404s, the StoaClient will throw a `StoaClientError`.

| Source | Location |
|--------|----------|
| detectAndSetVscode call | `src/renderer/app/App.vue:274` |
| detectVscode adapter method | `stoa-client-preload-adapter.ts:285-288` |

#### GAP-9: Generated Playwright Tests Hardcode Electron APIs (BLOCKER)

All 4 generated Playwright specs under `tests/generated/playwright/` import from `tests/e2e-playwright/fixtures/electron-app.ts` and use `_electron`, `electronApp.evaluate()`, `electronApp.firstWindow()`. These cannot run in a web project without regeneration.

| Source | Location |
|--------|----------|
| Generated specs | `tests/generated/playwright/*.generated.spec.ts` |
| Prior audit confirms | `research/2026-06-12-electron-e2e-and-generated-journey-tests-migration-inventory.md:216` |

#### GAP-10: No Web Test Directory (BLOCKER)

`tests/e2e-web/` does not exist. All existing E2E test files are in `tests/e2e/` (unit-style integration with mocked IPC) and `tests/e2e-playwright/` (Electron Playwright). No browser-based test directory.

| Source | Location |
|--------|----------|
| Directory listing | `tests/e2e-web/` — absent |
| Existing test dirs | `tests/e2e/`, `tests/e2e-playwright/`, `tests/generated/playwright/` |

---

### Dependency Map for Web E2E Readiness

```
GAP-1 (Playwright web project config)
  └── requires GAP-2 (web fixture library)
       └── requires server build (✅ exists: build:web)
       └── requires server --web startup (✅ exists: index.ts --web flag)
       └── requires token injection (GAP-4 — solvable via env var)

GAP-9 (generated tests) — separate from GAP-1/2
  └── requires generator template rewrite for web mode
```

### Priority Order

1. **GAP-1 + GAP-2 + GAP-10** — Create the minimal web Playwright project, fixture, and one smoke test
2. **GAP-5** — Understand which existing test patterns need web-specific guards
3. **GAP-8** — Verify all settings/detection routes exist on the server
4. **GAP-6** — Accept observability stubs as known limitation for initial web E2E
5. **GAP-9** — Defer generated test migration until manual web tests are green

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Web build config works | `vite.web.config.ts` | `vite.web.config.ts:1-21` |
| Shared renderer config | `vite.renderer.shared.ts` | `vite.renderer.shared.ts:1-22` |
| Feature flag VITE_USE_STOA_CLIENT | `vite.web.config.ts:12` | `vite.web.config.ts:12` |
| Electron build does NOT set flag | `electron.vite.config.ts` | `electron.vite.config.ts:1-51` (no define block) |
| Web bootstrap reads token from URL | `bootstrap-web.ts` | `src/renderer/bootstrap-web.ts:11-19` |
| Entry point conditional bootstrap | `main.ts` | `src/renderer/main.ts:9-10` |
| Full RendererApi adapter | `StoaClientPreloadAdapter` | `src/renderer/lib/stoa-client-preload-adapter.ts:1-650` |
| WS transport (hand-rolled) | `transport.ts` | `stoa-server/src/ws/transport.ts:1-409` |
| WS role router (auth + dispatch) | `role-router.ts` | `stoa-server/src/ws/role-router.ts:1-394` |
| Static file serving | `static.ts` | `stoa-server/src/routes/static.ts:1-19` |
| Static mount order tested | `static-mount-order.test.ts` | `stoa-server/src/routes/static-mount-order.test.ts:1-118` |
| Web client path resolution | `web-client-path.ts` | `stoa-server/src/shared/web-client-path.ts:1-21` |
| Server entry with --web flag | `index.ts` | `stoa-server/src/index.ts:37-56, 170-177` |
| Hono app with webClient option | `app.ts` | `stoa-server/src/app.ts:46-84` |
| Playwright config Electron-only | `playwright.config.ts` | `playwright.config.ts:1-19` |
| No web test dir | filesystem | `tests/e2e-web/` absent |
| CSP allows ws/wss | `index.html` | `src/renderer/index.html:7` |
| Observability stubs | `index.ts` | `stoa-server/src/index.ts:105-128` |
| Desktop-only adapter stubs | `StoaClientPreloadAdapter` | `stoa-client-preload-adapter.ts:89-93,259-267,291-310,313-365` |
| onSessionEvent no-op | `StoaClientPreloadAdapter` | `stoa-client-preload-adapter.ts:173-176` |
| Electron fixture | `electron-app.ts` | `tests/e2e-playwright/fixtures/electron-app.ts:1-309` |

### Risks / Unknowns

- [!] **BLOCKER:** No `webServer` config in `playwright.config.ts` means Playwright cannot auto-spawn the server for web tests
- [!] **BLOCKER:** No web fixture library means even with a project config, no test can boot the app
- [!] **BLOCKER:** Generated Playwright tests hardcode `_electron` imports — cannot be reused
- [!] **RISK:** Observability stubs return empty data — any test asserting presence/health indicators will fail
- [!] **RISK:** Desktop-only adapter stubs silently no-op — tests asserting update UI, window management, or workspace launcher will get wrong results
- [?] **UNKNOWN:** Does `/api/v1/settings/detect/vscode` route exist on the server? If not, `detectAndSetVscode()` will throw during web mount
- [?] **UNKNOWN:** Does `/api/v1/bootstrap` route fully populate `BootstrapState` for web mode? The server index.ts stubs some observability functions but the bootstrap route reads from the real `ProjectSessionManager`

---

## Context Handoff: Web-Client Build & Renderer Wiring Gaps

Start here: `research/2026-06-13-stoa-server-web-client-build-and-wiring-gaps.md`

Context only. Use the saved report as the source of truth.
