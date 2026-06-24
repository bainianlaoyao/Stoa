---
date: 2026-06-19
topic: Mobile renderer shell + xterm-backed mobile session view (renderer-only scope; backend health/IPC untouched)
status: completed
mode: context-gathering
sources: 24
---

## Context Report: Mobile Renderer Shell & xterm Mobile Session View

### Why This Was Gathered

Implementation context for the **Mobile UI V1** design spec (`docs/superpowers/specs/2026-06-19-mobile-ui-v1-design.md`), scoped specifically to the **renderer side**: a `MobileAppShell` branch + an xterm-backed mobile session view. The task explicitly excludes backend health/IPC files. This report maps the existing routing, store APIs, xterm infrastructure, test patterns, and design-token constraints an implementer must reuse.

### Summary

The renderer is a Vue 3 + Pinia app with a **single `App.vue` → `AppShell.vue`** desktop shell and a pluggable `RendererApi` bridge (`window.stoa`) that works in both Electron (IPC preload) and Web (HTTP+WS `StoaClient`) modes. The xterm terminal already exists as a self-contained, reusable component (`TerminalViewport.vue`) backed by `createTerminalRuntime()` — it is the exact surface to mount inside the mobile session view. There is **no existing mobile code, viewport/composable, or health API in the renderer**; mobile is greenfield renderer work. Design is hard-token-gated by `docs/engineering/design-language.md` (Fluent 2 CSS variables in `src/renderer/styles/tailwind.css`).

### Key Findings

#### 1. App.vue / AppShell routing & data flow (where MobileAppShell plugs in)

- **`App.vue`** is the only mount target (`src/renderer/main.ts:22-25`). It owns all stores + IPC subscriptions and renders `<AppShell>` plus `UpdatePrompt` and `MemoryToastHost`. All workspace/session handlers live here (e.g. `handleSessionSelect`, `handleSessionCreate`, `handleRestartSession`). (`src/renderer/app/App.vue:295-324`, `:50-164`)
- **`AppShell.vue`** is desktop-only: `<TitleBar>` + a `grid-cols-[56px_1fr_auto]` layout with `GlobalActivityBar` (56px), a `<section>` viewport switching between `CommandSurface`/`ArchiveSurface`/`SettingsSurface`, and `RightSidebar`. (`src/renderer/components/AppShell.vue:41-80`)
- The spec's intended split is `App.vue → DesktopAppShell | MobileAppShell` (`docs/superpowers/specs/2026-06-19-mobile-ui-v1-design.md:69-90`). Activation is **viewport width only: `<= 768px`** (`docs/...mobile-ui-v1-design.md:56-66`). There is no existing media-query composable in `src/renderer/composables/` — detection must be added (the closest existing pattern is `window.matchMedia('(prefers-color-scheme: dark)')` in `src/renderer/stores/settings.ts:235-238`).
- **Data flow into the shell** is via props emitted from `App.vue`: `hierarchy`, `activeProjectId`, `activeSessionId`, `activeProject`, `activeSession`, plus 9 emit channels (`selectProject`, `selectSession`, `createProject`, `createSession`, `deleteProject`, `archiveSession`, `regenerateSessionTitle`, `restartSession`, `restoreSession`, `openWorkspace`). (`src/renderer/app/App.vue:297-314`, `src/renderer/components/AppShell.vue:13-32`) — `MobileAppShell` should reuse the same prop/emit contract so `App.vue` can host both.

#### 2. Workspace / session store APIs usable by renderer

- `useWorkspaceStore` (`src/renderer/stores/workspaces.ts`) is the renderer's source of truth. Relevant exported members for mobile (`:726-758`):
  - State: `projects`, `sessions`, `activeProjectId`, `activeSessionId`, `lastError`, `sessionPresenceById`, `appObservability`.
  - Computed: `projectHierarchy` (groups sessions per project, splits `sessions` vs `archivedSessions`) — **this is the mobile Workspace List / Session List data source** (`:255-278`); `activeProject`, `activeSession`, `activeSessionPresence`, `sessionPresenceMap`.
  - Actions: `setActiveProject`, `setActiveSession` (also sets owning project), `addSession`, `archiveSession`, `restoreSession`, `applySessionGraphEvent`, `hydrate`, `hydrateFromStoaClient`, `hydrateObservability`, `unsubscribeObservability`.
  - `SessionSummary` type (`src/shared/project-session.ts:122-153`): has `id, projectId, type, runtimeState, turnState, blockingReason, failureReason, title, summary, updatedAt, lastActivatedAt, archived` — enough for mobile row rendering (name, status dot, provider/model via `sessionPresenceMap`/providerLabel, recent activity).
- Session **status semantics** for mobile filters come from `SessionPresenceSnapshot.phase` ∈ `ready | running | blocked | complete | failure` (distinct from transport health). `applyLightweightSessionPresenceEvent` (`src/renderer/stores/workspaces.ts:483-518`) shows the canonical phase set; the spec's Session List sort (`running/blocked` first) maps onto these phases (`docs/...mobile-ui-v1-design.md:240-247`).
- `useSettingsStore` (`src/renderer/stores/settings.ts`): exposes `terminal` (Partial<TerminalSettings>), `resolvedTerminalSettings()`, `loadSettings`, `locale`, `theme`, `applyTheme`. Mobile Settings page can reuse this store directly.

#### 3. RendererApi bridge (terminal methods) — the contract mobile reuses, no edits needed

- `RendererApi` is defined in `src/shared/project-session.ts:606-665`. Terminal-relevant methods (already implemented in both Electron preload and the web `StoaClientPreloadAdapter`):
  - `getTerminalReplay(sessionId): Promise<string>` (`:617`)
  - `sendSessionInput(sessionId, data): void` (`:618`)
  - `sendSessionBinaryInput(sessionId, data: Uint8Array): void` (`:619`)
  - `sendSessionResize(sessionId, cols, rows): Promise<void>` (`:620`)
  - `onTerminalData(cb): () => void` (`:621`)
  - `onSessionPresenceChanged(cb): () => void` (`:633`)
  - `onMemoryNotification`, `onTitleGenerationNotification`, `restartSession`, `archiveSession`, `restoreSession`, `createSession`, `listArchivedSessions`.
- **There is NO health method on `RendererApi`** (read the full interface `:606-665`). The spec wants a backend health API (`docs/...mobile-ui-v1-design.md:492-556`), but per task scope that is **out of bounds** (it would require backend + IPC/preload edits). The mobile shell should treat health as an injected/placeholder signal until that separate task lands.
- Bridge access helpers: `requireRendererApi()`, `getRendererApi()`, `getStoaClient()`, `isStoaClientMode()` in `src/renderer/stores/stoa-store-plugin.ts`. `window.stoa` is set in both bootstraps (`bootstrap-web.ts:39-40`; desktop sets it via `bootstrapDesktopRenderer`).

#### 4. Existing terminal / xterm components & dependencies

- **xterm stack** (already deps): `@xterm/xterm` + addons `fit`, `search`, `serialize`, `unicode11`, `web-links`, `webgl`, `clipboard`. (`package.json:48-55`)
- **`createTerminalRuntime()`** (`src/renderer/terminal/xterm-runtime.ts:163-264`) builds a `Terminal` with FitAddon, theme (reads `--color-terminal-*` CSS vars), optional WebglAddon, SearchAddon, SerializeAddon, ClipboardAddon, ShellIntegrationAddon. This is the factory to reuse for the mobile terminal; **do not fork the theme logic**.
- **`TerminalViewport.vue`** (`src/renderer/components/TerminalViewport.vue`) is the mountable, self-contained terminal surface. It already implements: replay-then-live merge with a 1s fallback timer (`:159-371`), ResizeObserver→`sendSessionResize` debounced 150ms (`:307-323`), `onData`→`sendSessionInput`, `onBinary`→`sendSessionBinaryInput`, copy-on-Ctrl+C-with-selection (`:177-205`), visibility-gated fit via the `visible` prop (`:390-397`). **Props**: `project`, `session`, `activeViewModel?`, `visible?`. **Emits**: `openWorkspace`. This component is directly reusable as the mobile Session Xterm View's terminal core.
- **`TerminalSessionDeck.vue`** (`src/renderer/components/command/TerminalSessionDeck.vue`) wraps multiple `TerminalViewport`s with persistent-AI-session keep-alive logic (`PERSISTENT_AI_SESSION_TYPES = codex/opencode/claude-code`, `:18`). Desktop-only concerns (multi-deck, quick actions) — mobile should wrap a **single** `TerminalViewport`, not the deck.
- Mobile-only concerns from the spec that **`TerminalViewport.vue` does not yet handle**: input-gating on health (`Reconnecting`/`Offline` must freeze input but keep scroll/selection/copy — `docs/...mobile-ui-v1-design.md:340-352`), right-side **Keys handle + vertical key rail** (Esc/Tab/Up/Down/`/`/`-`/Copy/Paste/Enter) that overlays without triggering column recalc (`docs/...mobile-ui-v1-design.md:382-428`), and per-`sessionId` display prefs (wrap/h-scroll/text-size) stored renderer-side (`docs/...mobile-ui-v1-design.md:354-381`). The existing `attachCustomKeyEventHandler` shows where input interception hooks in (`TerminalViewport.vue:177-205`).

#### 5. Mobile component/test patterns — greenfield (no existing mobile code)

- Grep for `mobile|isMobile|responsive|breakpoint` across `src/renderer` → **no matches**. No mobile components, no `useMediaQuery` composable. This is net-new renderer code under `src/renderer/components/` (mirror the existing `command/`, `settings/`, `archive/` folder pattern).
- **Component test pattern** (Vitest + happy-dom + `@vue/test-utils`): mount with `createPinia()`, mock `window.stoa` via `createRendererApiMock()` from `@shared/test-fixtures` (see `src/renderer/components/AppShell.test.ts:168-239`), stub heavy children with `defineComponent` render fns. Terminal-specific test harness (xterm mock + RAF mock + `flushTerminal()` + `createMockApi()` with callback arrays) is in `src/renderer/components/TerminalViewport.test.ts:16-266` — **reuse this verbatim** for any mobile terminal component test.
- **Topology assets** live in `testing/topology/*.topology.ts`, defined via `defineTopology({ surface, testIds })` (see `testing/topology/terminal.topology.ts`). The spec lists the required `mobile-*` testids (`docs/...mobile-ui-v1-design.md:587-644`) → add a new `testing/topology/mobile.topology.ts`.
- **Behavior assets** live in `testing/behavior/*.behavior.ts` via `defineBehavior({ id, actor, goal, action, expects, interruptions, recovery, risk, coverageBudget })` (see `testing/behavior/session.behavior.ts`). The spec lists required mobile behaviors (`docs/...mobile-ui-v1-design.md:646-670`).
- **Journey assets** in `testing/journeys/*.journey.ts`; generated Playwright specs go to `tests/generated/playwright/*.generated.spec.ts` via `npm run test:generate` (**never hand-edit** — `CLAUDE.md` Quality Gate). Playwright projects: `electron` (matches `e2e-playwright/**` + `generated/playwright/**`) and `web` (matches `e2e-web/**`, chromium) — `playwright.config.ts:18-30`. Mobile journeys most naturally belong in the **web** project at mobile viewports.
- Viewport acceptance targets from the spec: `390x844`, `360x800`, `844x390` landscape, `1280x800` desktop regression (`docs/...mobile-ui-v1-design.md:746-753`).

#### 6. Token / design constraints (hard gate)

- Authority: `docs/engineering/design-language.md` + `CLAUDE.md` (treats it as a hard constraint). Token-first; **no hardcoded colors/radii/shadows**; no Fluent Web Components this pass (`docs/engineering/design-language.md:17-153`).
- Tokens are CSS variables in `src/renderer/styles/tailwind.css`. Material roles: `--mica` / `--mica-alt` (durable mobile app surfaces), `--surface-solid` (dense content, terminal-adjacent controls, list rows, fields), `--acrylic` (transient layers: search, sheets, action sheets, menus), `--smoke` (modal dim). (`tailwind.css:142-160` light; `:182+` dark; design-language `:24-55`).
- Text: `--text-strong`, `--text`, `--muted`/`--subtle`. Controls: `--control-fill(-hover/-active)`, `--stroke-control`, `--stroke-divider`, `--accent`, `--active-fill`. Radii: `--radius-lg/md/sm` (`:36-38`). Motion: `--duration-rest`/`--duration-emphasized`, `--curve-standard`/`--curve-decelerate` (`:98-101`). Fonts: `--font-ui`, `--font-mono` (`:83-84`, mono mandatory for terminal/ids/paths).
- **Terminal colors stay terminal-specific**: `--color-terminal-bg: #0a0b0d` + full ANSI set + `--terminal-shell-gap` (`tailwind.css:50`, `xterm-runtime.ts:36-58`). The xterm theme is resolved from these vars — mobile terminal inherits the same readability tokens.
- Accessibility: 44px min touch target, icon-only controls need accessible names, health/status must not be color-only (keep textual/aria equivalents for tests) (`docs/...mobile-ui-v1-design.md:574-585`).

#### 7. Exact narrow test commands (from package.json + spec)

- `npm run test:generate` — regenerate deterministic generated Playwright artifacts (`package.json:35`). **Run first**; never hand-edit `tests/generated/`.
- `npm run typecheck` — `vue-tsc` (web) + `tsc` (node) (`package.json:33`).
- `npx vitest run` — unit + component + integration + static + generator tests (`package.json:34`).
- `npm run test:e2e:web` — build + stoa-server build + Playwright **web** project (chromium) at desktop viewport (`package.json:39`) — closest existing harness for mobile web journeys (would need a mobile-viewport variant).
- `npm run test:e2e` — full electron + web (`package.json:36`).
- `npm run test:behavior-coverage` — behavior coverage budget gate (`package.json:40`); adding mobile behaviors likely needs a budget entry.
- One-shot: `npm run test:all` (`package.json:41`).
- A mobile unit test can be run narrowly via `npx vitest run src/renderer/components/mobile/<file>.test.ts`; a mobile topology/behavior test via `npx vitest run testing/topology/mobile.topology.test.ts`.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Only `App.vue` mounts; shell plug-in point | `src/renderer/main.ts` | `:10-26` |
| `App.vue` owns stores + IPC subs + all handlers | `src/renderer/app/App.vue` | `:24-164`, `:295-324` |
| Desktop `AppShell` grid layout + surfaces + RightSidebar | `src/renderer/components/AppShell.vue` | `:41-80` |
| Mobile spec: split shell, `<=768px` width-only activation | design spec | `docs/superpowers/specs/2026-06-19-mobile-ui-v1-design.md:56-90` |
| `matchMedia` precedent (no composable exists) | `src/renderer/stores/settings.ts` | `:235-238` |
| Workspace store exports + `projectHierarchy` | `src/renderer/stores/workspaces.ts` | `:255-278`, `:726-758` |
| `SessionSummary` fields | `src/shared/project-session.ts` | `:122-153` |
| Session phases `ready/running/blocked/complete/failure` | `src/renderer/stores/workspaces.ts` | `:483-518` |
| `RendererApi` terminal + lifecycle methods | `src/shared/project-session.ts` | `:606-665` |
| Bridge helpers `requireRendererApi`/`getStoaClient`/`isStoaClientMode` | `src/renderer/stores/stoa-store-plugin.ts` | `:20-55` |
| Web bootstrap sets `window.stoa` | `src/renderer/bootstrap-web.ts` | `:22-43` |
| xterm runtime factory + theme-from-CSS-vars | `src/renderer/terminal/xterm-runtime.ts` | `:163-264`, `:36-161` |
| `TerminalViewport` replay/resize/input/visibility logic + props/emits | `src/renderer/components/TerminalViewport.vue` | `:13-25`, `:151-399` |
| `TerminalSessionDeck` (desktop-only multi-deck) | `src/renderer/components/command/TerminalSessionDeck.vue` | `:18`, `:105-155` |
| No existing mobile/responsive code | grep | `src/renderer/**` (0 matches) |
| Component test mock pattern (`createRendererApiMock`, stubs) | `src/renderer/components/AppShell.test.ts` | `:54-166`, `:168-239` |
| Terminal test harness (xterm mock + RAF + flushTerminal) | `src/renderer/components/TerminalViewport.test.ts` | `:16-266` |
| Topology DSL `defineTopology` | `testing/topology/terminal.topology.ts` | `:1-16` |
| Behavior DSL `defineBehavior` | `testing/behavior/session.behavior.ts` | `:1-45` |
| Required mobile testids + behaviors | design spec | `docs/...mobile-ui-v1-design.md:587-670` |
| Playwright projects (electron/web), matchers | `playwright.config.ts` | `:18-30` |
| Design tokens (material/text/control/radius/motion/font) | `src/renderer/styles/tailwind.css` | `:36-101`, `:142-191` |
| Terminal readability tokens | `src/renderer/styles/tailwind.css` | `:50` |
| Design language authority + non-negotiable rules | `docs/engineering/design-language.md` | `:17-153` |
| Test commands | `package.json` | `:33-41` |
| Quality gate rules (no hand-edit generated, no `as any`) | `CLAUDE.md` | Quality Gate section |

### Risks / Unknowns

- [!] **Health API is out of scope and does not exist.** `RendererApi` has no health method (`src/shared/project-session.ts:606-665`); the spec's `Connected/Reconnecting/Offline` input-gating (`docs/...mobile-ui-v1-design.md:492-556`) depends on a backend health API + IPC/preload wiring that this task must not touch. The mobile shell must either (a) stub health as always-`Connected` for now, or (b) derive a provisional transport signal from `StoaClient` WS reconnect state (`src/renderer/lib/stoa-client.ts:254-263`) — but the spec explicitly forbids inferring health from incidental IPC/WS failures (`docs/...mobile-ui-v1-design.md:513-516`), so a stub is the spec-compliant interim.
- [!] **`TerminalViewport.vue` is shared by desktop.** Adding health-based input gating or a Keys rail there risks desktop regressions; prefer composing a mobile-specific `MobileSessionTerminal.vue` that wraps `TerminalViewport` (or factors the mount logic) rather than forking it. The spec flags this risk explicitly (`docs/...mobile-ui-v1-design.md:772-773`).
- [!] **Key rail must not trigger xterm column recalc** (`docs/...mobile-ui-v1-design.md:399-404, 773`). Overlay positioning must avoid ResizeObserver-driven `fit()` inside `TerminalViewport` (`src/renderer/components/TerminalViewport.vue:307-323`).
- [?] Exact component boundaries / final testids are left to implementation per spec ("Exact ids can change during implementation") (`docs/...mobile-ui-v1-design.md:644`). Behavior-coverage budget may need a new mobile allocation entry in `testing/generators/behavior-coverage.ts` (not read in this pass).
- [?] Where the mobile Playwright journeys live (electron vs web project, `e2e-web/**` vs new dir) is undecided; the **web** chromium project (`playwright.config.ts:24-29`) is the natural host since mobile targets remote browser clients, but mobile viewport config is not yet defined anywhere.
- [?] `bootstrap-electron.ts` was not read in this pass (desktop path). If mobile must also work under Electron (it should, per "same renderer"), the viewport detection in `App.vue` must run in both bootstraps; this was inferred, not verified.
