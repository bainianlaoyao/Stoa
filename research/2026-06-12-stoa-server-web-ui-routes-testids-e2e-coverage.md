---
date: 2026-06-12
topic: stoa-server-web-ui-routes-testids-e2e-coverage
status: completed
mode: context-gathering
sources: 35
---

## Context Report: Stoa Server Web UI — Routes, Test IDs, and E2E Coverage Gaps

### Why This Was Gathered
To understand the current state of the Stoa Server web UI code, HTTP/WebSocket routes, data-testid topology, and existing browser/E2E test coverage; and to identify gaps versus a full UI end-to-end suite.

### Summary

The Stoa Server is a Hono-based HTTP + WebSocket server (`stoa-server/`) with 8 REST route groups, webhook endpoints, and WebSocket hub. It has a **placeholder fallback HTML** for web client mode but **no actual Vue SPA web client** has been built yet (`dist/web/` is empty). All existing E2E/Playwright tests target the **Electron app** — none test the server's HTTP API or web UI via browser. The test-id topology covers 8 surfaces (command, activity-bar, modal, terminal, archive, session-status, provider, memory-notification, stoactl) but these are all for the Electron renderer, not the server web client.

### Key Findings

#### 1. Server Architecture (Hono on Node)

- **Framework**: Hono with `@hono/node-server`
- **Entry**: `stoa-server/src/index.ts:1` — parses CLI args (`--port`, `--web`, `--lan`), bootstraps services, starts server
- **App factory**: `stoa-server/src/app.ts:46` — `createApp(deps, options)` mounts middleware + route groups
- **Web client flag**: `--web` enables static file serving; checks `dist/web/index.html` existence (`stoa-server/src/routes/discovery.ts:48`)

#### 2. Complete Route Map

| Route Group | Mount Path | Source File | Endpoints |
|---|---|---|---|
| Discovery | `/api/v1/discovery` | `stoa-server/src/routes/discovery.ts:19` | `GET /` (unauthenticated) |
| Health | `/ctl` | `stoa-server/src/routes/health.ts` | `GET /health` |
| Projects | `/api/v1` | `stoa-server/src/routes/projects.ts:77` | `GET /bootstrap`, `POST /projects`, `DELETE /projects/:id`, `PUT /projects/:id/active` |
| Sessions | `/api/v1` | `stoa-server/src/routes/sessions.ts:77` | `POST /sessions`, `PUT /sessions/:id/active`, `PUT /sessions/:id/archive`, `PUT /sessions/:id/restore`, `POST /sessions/:id/restart`, `PUT /sessions/:id/title`, `GET /sessions`, `GET /sessions/:id/terminal-replay`, `POST /sessions/:id/input`, `POST /sessions/:id/resize`, `DELETE /projects/:id/sidecar`, `GET /sessions/:id/evidence`, `GET /sessions/:id/context/full`, `GET /sessions/:id/context/slim` |
| Settings | `/api/v1` | `stoa-server/src/routes/settings.ts` | `GET /settings`, `PUT /settings/:key`, `POST /settings/detect/shell`, `POST /settings/detect/provider`, `GET /settings/title-generation/models` |
| Sidebar | `/api/v1` | `stoa-server/src/routes/sidebar.ts:34` | `GET /sidebar`, `PUT /sidebar` |
| Observability | `/api/v1` | `stoa-server/src/routes/observability.ts:72` | `GET /observability/sessions/:id/presence`, `GET /observability/projects/:id`, `GET /observability/app`, `GET /observability/sessions/:id/events` |
| Meta-Sessions | `/api/v1` | `stoa-server/src/routes/meta-sessions.ts:104` | `GET /meta-sessions/bootstrap`, `POST /meta-sessions`, `POST /meta-sessions/:id/activate`, `POST /meta-sessions/:id/archive`, `POST /meta-sessions/:id/restore`, `GET /meta-sessions/:id/proposals`, `GET /meta-sessions/proposals/:proposalId`, `POST /meta-sessions/proposals/:id/approve`, `POST /meta-sessions/proposals/:id/reject`, `POST /meta-sessions/proposals/:id/dispatch`, `PUT /meta-sessions/inspector` |
| Control (stoa-ctl) | `/ctl` | `stoa-server/src/routes/control.ts:157` | `GET /whoami`, `GET /capabilities`, `GET /session/list`, `GET /session/:id/inspect`, `GET /session/:id/status`, `GET /session/:id/output`, `GET /session/:id/completion-report`, `GET /session/:id/wait`, `POST /session/:id/input`, `POST /session/:id/destroy`, `POST /session/create`, `GET /subagent/list`, `POST /subagent/dispatch`, `POST /subagent/wait`, `POST /subagent/input`, `POST /subagent/stop`, `POST /subagent/result` |
| Meta-Control | `/ctl` | `stoa-server/src/routes/meta-control.ts` | (mounted alongside control) |
| Webhooks | `/hooks` (via `app.ts`) | `stoa-server/src/routes/webhooks.ts:312` | `POST /events`, `POST /hooks/claude-code`, `POST /hooks/codex`, `POST /hooks/opencode`, `POST /memory-notifications` |
| Static | `/` (fallback) | `stoa-server/src/routes/static.ts:11` | `GET /assets/*`, `GET *` (SPA fallback) |

#### 3. WebSocket Hub

- **Source**: `stoa-server/src/ws/hub.ts:23` — `WsHub` class
- **Events**: Typed `WsServerEventType` from `stoa-server/src/ws/events.ts`
- **Features**: Client registration, subscription filters (by sessionId), broadcast, reconnection replay via `getMissedEvents()`
- **History**: Last 1000 events kept in memory

#### 4. Web Client Status

- **Fallback HTML**: `stoa-server/public/index.html:1` — simple "Web client not available" placeholder
- **Static serving**: `stoa-server/src/routes/static.ts:14` — serves `dist/web/` assets
- **dist/web/ does NOT exist** — `isWebClientAvailable()` checks `dist/web/index.html` (file not found)
- **No Vue SPA code found** — no `web-client/`, no `src/web/`, no web-specific Vue components
- **The server is API-only** — the `--web` flag is wired but the Vue build artifacts are absent

#### 5. StoaClient (HTTP + WS Client Library)

- **Source**: `src/renderer/lib/stoa-client.ts:61` — `StoaClient` class
- **Used in**: Renderer via `StoaClientPreloadAdapter` (`src/renderer/lib/stoa-client-preload-adapter.ts`)
- **Features**: REST CRUD (get/post/put/delete), WebSocket with reconnect, binary terminal input, event subscription
- **Purpose**: Replaces Electron IPC for non-desktop operation — currently used by the Electron renderer when the server is spawned

#### 6. Existing Server-Side Tests (HTTP-level, no browser)

| Test File | Scope |
|---|---|
| `stoa-server/src/routes/routes.test.ts` | Discovery, health, auth middleware, error handler |
| `stoa-server/src/routes/api-routes.test.ts` | All `/api/v1/` endpoints (projects, sessions, settings, sidebar, observability, runtime bridge stubs, auth) |
| `stoa-server/src/routes/webhook-routes.test.ts` | Webhook validation and provider adapters |
| `stoa-server/src/routes/control-routes.test.ts` | `/ctl/` control routes |
| `stoa-server/src/services/persistence-backend.test.ts` | SQLite + JSON persistence |
| `stoa-server/src/ws/hub.test.ts` | WebSocket hub |
| `stoa-server/src/ws/broadcast.test.ts` | WS broadcast |
| `stoa-server/src/ws/runtime-bridge-handler.test.ts` | Runtime bridge WS handler |
| `stoa-server/src/db/schema.test.ts` | DB schema |
| `stoa-server/src/db/migrate-from-json.test.ts` | Migration |

All server tests use Hono's `app.request()` — no real HTTP server, no browser.

#### 7. Existing Playwright E2E Tests (Electron-only)

| Test File | What It Tests |
|---|---|
| `tests/e2e-playwright/app-smoke.test.ts` | Boot, viewport, command-panel, activity icons |
| `tests/e2e-playwright/project-session-journey.test.ts` | Create project/session, verify data attributes |
| `tests/e2e-playwright/terminal-journey.test.ts` | Terminal viewport lifecycle |
| `tests/e2e-playwright/recovery-journey.test.ts` | App recovery after crash |
| `tests/e2e-playwright/session-event-journey.test.ts` | Session events via webhook → UI update |
| `tests/e2e-playwright/sidebar-interaction.test.ts` | Right sidebar toggle, tab switching |
| `tests/e2e-playwright/file-explorer.test.ts` | File explorer panel |
| `tests/e2e-playwright/git-panel.test.ts` | Git/source control panel |
| `tests/e2e-playwright/search-panel.test.ts` | Search panel |
| `tests/e2e-playwright/settings-modal-ui.test.ts` | Settings tabs, modal, search |
| `tests/e2e-playwright/debug-devtools.test.ts` | Debug/devtools |

**None of these test the Stoa Server HTTP API via browser or HTTP client in Playwright.** All launch the Electron app.

#### 8. Generated Playwright Specs

| File | Source Journey |
|---|---|
| `tests/generated/playwright/session-restore.generated.spec.ts` | `testing/journeys/session-restore.journey.ts` |
| `tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts` | `testing/journeys/session-telemetry.journey.ts` |
| `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts` | `testing/journeys/stoactl-lifecycle.journey.ts` |
| `tests/generated/playwright/workspace-quick-access.generated.spec.ts` | `testing/journeys/workspace-quick-access.journey.ts` |

All generated specs target Electron via `launchElectronApp()`.

#### 9. Test-ID Topology (8 surfaces, all Electron renderer)

| Topology | Source | Key Test IDs |
|---|---|---|
| Command | `testing/topology/command.topology.ts` | `app-viewport`, `command-panel`, `command-body`, `command-layout`, `workspace-hierarchy-panel`, `route-body`, `route-actions`, `project-row`, `session-row`, `session-status-dot` |
| Activity Bar | `testing/topology/activity-bar.topology.ts` | `activity-bar`, `activity-cluster-top`, `activity-cluster-bottom` |
| Modal | `testing/topology/modal.topology.ts` | `modal-root`, `modal-overlay`, `modal-panel`, `modal-title`, `modal-close`, `modal-body` |
| Terminal | `testing/topology/terminal.topology.ts` | `terminal-viewport`, `terminal-xterm`, `terminal-shell`, `terminal-xterm-mount`, `terminal-empty-state` |
| Archive | `testing/topology/archive.topology.ts` | `surface.archive`, `archive.session.row`, `archive.session.restore` |
| Session Status | `testing/topology/session-status.topology.ts` | `workspace-hierarchy-panel`, `route-body`, `route-actions`, `session-status-dot`, `session-status-ready/running/complete/blocked/failure` |
| Provider | `testing/topology/provider.topology.ts` | `provider-card`, `provider-card.item`, `provider-radial`, `provider-radial.item` |
| Memory Notification | `testing/topology/memory-notification.topology.ts` | `memory-toast-host`, `memory-toast` |
| StoaCtl | `testing/topology/stoactl-topology.ts` | `settings-stoactl-toggle`, `settings-advanced-tab` |

**None of these test IDs are for a web UI served by the Stoa Server.**

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Server uses Hono framework | `stoa-server/src/app.ts:9` | `import { Hono } from 'hono'` |
| Web client flag checks dist/web/ | `stoa-server/src/routes/discovery.ts:48` | `existsSync(resolve(..., 'dist/web/index.html'))` |
| Static serving routes defined | `stoa-server/src/routes/static.ts:14-17` | `serveStatic({ root: './dist/web' })` |
| dist/web/ directory does not exist | Glob search `stoa-server/dist/web/**/*` | No files found |
| No web-client directory found | Glob search `**/web-client/**/*` | No files found |
| Public HTML is fallback only | `stoa-server/public/index.html:25` | "Web client not available" |
| StoaClient HTTP+WS client exists | `src/renderer/lib/stoa-client.ts:61` | Full REST + WS client class |
| All Playwright tests use Electron | `tests/e2e-playwright/fixtures/electron-app.ts:110` | `launchElectronApp()` helper |
| No browser-based server E2E tests | Glob + Read of all `tests/e2e-playwright/*.test.ts` | None use HTTP fetch or browser for server |
| 8 topology surfaces defined | `testing/topology/*.ts` | All reference Electron renderer components |
| Server unit tests use app.request() | `stoa-server/src/routes/api-routes.test.ts:137` | `app.request('/api/v1/bootstrap', ...)` |

### Gaps vs. Full UI End-to-End Suite

#### Critical Gaps

1. **No Vue SPA Web Client** — The most fundamental gap. The server has `--web` wiring but no Vue application to serve. A web UI must be built before any browser E2E tests can exist.

2. **No Browser-Based Server API Tests** — All server API tests use Hono's in-process `app.request()`. There are zero tests that start the real server and make HTTP calls to it (e.g., via Playwright's `request` context or `fetch`).

3. **No Server Integration Tests with Real HTTP** — The server has never been tested with a real HTTP listener (e.g., `supertest` against the Hono server). This means `serve()` integration, static file serving, WebSocket upgrade, CORS preflight, and real auth middleware are untested at the integration level.

#### Medium Gaps

4. **No WebSocket E2E Tests** — The WsHub is unit-tested, but no test verifies a real WebSocket connection upgrade through the HTTP server, subscription flow, or reconnection replay.

5. **No Webhook Delivery E2E via HTTP** — Webhook tests are unit-level. No test starts the server, sends a real HTTP POST to `/hooks/claude-code`, and verifies event propagation through the WebSocket hub.

6. **No Test-ID Topology for Server Web UI** — When the web client is built, it will need its own topology definitions for Playwright selectors. The current topology is Electron-only.

#### Minor Gaps

7. **No Performance/Load Tests** — Server has never been tested under concurrent load.

8. **No Multi-Client WebSocket Tests** — WsHub supports multiple subscribers but this is only unit-tested.

9. **Discovery Route Missing Real Web Client Detection** — The `isWebClientAvailable()` check only looks for `dist/web/index.html`; there's no health check for whether the SPA itself is functional.

### Risks / Unknowns

- [!] The `--web` flag is wired but the Vue SPA doesn't exist — this is a "ready but empty" state. Building the SPA is a prerequisite for any browser E2E.
- [?] Whether a separate Playwright project/config is needed for server browser tests vs. Electron tests, or if they can share fixtures.
- [?] Whether the existing `StoaClient` library should be reused as the web SPA's API layer, or if a separate web-specific client is planned.
- [!] The server's static route fallback sends `index.html` for ALL unmatched routes — this means 404s for missing API routes may silently return HTML instead of JSON if the fallback route matches first. The current mount order (API first, static last) mitigates this, but only if the mount order is maintained.
