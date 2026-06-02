---
date: 2026-06-02
topic: frontend-architecture-fluent2-refactor-context
status: completed
mode: context-gathering
sources: 18
---

## Context Report: Frontend Architecture & Visual Constraints for Fluent 2 Design-System Refactor

### Why This Was Gathered
A Fluent 2 design-system refactor is planned. This report provides the bounded context needed to plan that refactor: the current package stack, component layout hierarchy, design token system, authoritative design-language constraints, and the test/topology surface that must remain passing.

### Summary
Stoa is an Electron desktop app (Electron 37) with a Vue 3.5 + Pinia 3 renderer using Tailwind CSS 4.2 and `@headlessui/vue` for accessible primitives. The single-file design token system (`src/renderer/styles/tailwind.css`) defines all colors, shadows, radii, and fonts via CSS custom properties with a dual light/dark theme. The authoritative design-language doc mandates Modern Minimalist Glassmorphism with z-axis hierarchy (blur, transparency, subtle shadows). The layout is a 3-column grid: 56px activity bar → main viewport (command/archive/settings surfaces) → optional right sidebar. The test surface includes 8 topology contracts, 10 behavior assets, and generated Playwright journeys — all keyed on stable `data-testid` attributes.

### Key Findings

#### 1. Package Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Electron | ^37.4.0 |
| Build | electron-vite | ^4.0.0 |
| Framework | Vue | ^3.5.22 |
| State | Pinia | ^3.0.3 |
| CSS | Tailwind CSS | ^4.2.4 (via `@tailwindcss/vite`) |
| i18n | vue-i18n | ^11.3.2 |
| UI Primitives | @headlessui/vue | ^1.7.23 |
| Terminal | @xterm/xterm | 6.1.0-beta.216 |
| Test | Vitest ^3.2.4, Playwright ^1.57.0, @vue/test-utils ^2.4.6 |
| DOM env | happy-dom ^18.0.1 |
| TypeScript | ^5.9.3 |
| Bundler | Vite ^7.1.7 |

The build pipeline uses `@tailwindcss/vite` plugin (Tailwind 4 native Vite integration). No PostCSS config. No separate CSS preprocessor.

#### 2. Component Layout Hierarchy

The root layout is `AppShell.vue` with a 3-column CSS grid:

```
AppShell.vue
├── TitleBar.vue
└── main (grid: 56px | 1fr | auto)
    ├── GlobalActivityBar.vue (56px fixed nav, 3 surfaces: command/archive/settings)
    ├── section#app-viewport (1fr, glass surface with backdrop-blur-[30px])
    │   ├── CommandSurface.vue (v-show, active when surface='command')
    │   │   ├── WorkspaceHierarchyPanel.vue (resizable left panel, 160–480px)
    │   │   └── TerminalSessionDeck.vue
    │   │       └── TerminalViewport.vue (xterm.js terminal)
    │   ├── ArchiveSurface.vue (v-if, surface='archive')
    │   └── SettingsSurface.vue (v-if, surface='settings')
    └── RightSidebar.vue (auto, resizable 220–800px, always-mounted with CSS hide)
        ├── TabBar.vue
        ├── FileExplorer.vue
        ├── SearchPanel.vue
        └── SourceControlPanel.vue
```

Key layout patterns:
- **Grid-based, not flex**: Main layout is `grid-cols-[56px_1fr_auto]` in `AppShell.vue:40`.
- **Surface switching**: `v-show` for CommandSurface (keeps terminal alive), `v-if` for Archive/Settings (lazy mount).
- **Resizable panels**: Both the session list and right sidebar use a `usePanelResize` composable with drag handles.
- **Sidebar panels**: Registered via `useSidebarPanels()` composable with dynamic component loading.

All 36 `.vue` components are in `src/renderer/components/`, organized into subdirectories: `command/`, `right-sidebar/`, `settings/`, `archive/`, `primitives/`, `inbox/`, `tree/`, `update/`, `memory/`.

#### 3. Design Token / Style System

**Single source of truth**: `src/renderer/styles/tailwind.css` — one file containing all tokens.

**Token architecture** (Tailwind 4 `@theme` block, lines 3–93):
- Colors are defined as `--color-*` Tailwind theme vars that map to `--*` CSS custom properties
- Dual theme: `:root / .theme-light` (lines 124–171) and `.theme-dark` (lines 173–217)
- Token categories: canvas (backgrounds), surface (3 tiers: base/solid/soft), line (borders), text (strong/text/muted/subtle), accent, active-fill, semantic (success/warning/attention/confirm/error), overlay-scrim, monochrome helpers (black-soft/faint, white-strong/soft/faint)
- Shadow tokens: glass, soft, card, premium, focus-ring — all with `-val` suffix (values defined per-theme)
- Radius tokens: lg=12px, md=6px, sm=4px (comment says "Windows 11 Modern Fluent Geometry")
- Font tokens: `--font-ui` (SF Pro Text / Segoe UI Variable / Inter stack), `--font-mono` (JetBrains Mono / Cascadia Mono stack)
- Font size tokens: caption(11px), meta(12px), body-sm(13px), body(14px), title-sm(15px), title(18px)
- Terminal tokens: Separate dark-mode-only color set (terminal-bg, terminal-text, ANSI colors)

**Shared utility classes** (Tailwind 4 `@utility` blocks):
- `btn-primary`, `btn-ghost` — button variants with hover/active/focus-visible states
- `eyebrow` — section header label style
- `settings-panel`, `settings-card` — settings layout utilities
- `fluent-bounce`, `fluent-springy` — animation utilities

**Bundled fonts**: JetBrains Mono (woff2 variable), Cascadia Mono (woff2) — both stored in `src/renderer/assets/fonts/`.

#### 4. Design Language Constraints (Authoritative Doc)

`docs/engineering/design-language.md` (158 lines) defines 4 non-negotiable rules:

1. **Design tokens only** — No hardcoded colors, shadows, or radii. Use `var(--canvas)`, `var(--surface)`, etc.
2. **Z-axis hierarchy** — Build depth through transparency/blur/shadow, not heavy borders. `backdrop-filter: blur(40px)` for glass surfaces. Borders: `1px solid var(--line)`.
3. **Restrained micro-interactions** — Hover: transparency/brightness changes. Active: light shadow + border. Motion: `transition: all 0.2s ease`. No exaggerated animation.
4. **Typography discipline** — `--font-ui` for all UI structure. `--font-mono` for terminal/paths/IDs/code.

Bad/Good examples are provided (lines 119–138). The doc applies to all renderer UI, preview HTML, new modules, and refactors.

#### 5. Primitives Component Inventory

Reusable primitives in `src/renderer/components/primitives/`:

| Component | UI Library | Key Design Tokens Used |
|-----------|-----------|----------------------|
| `BaseModal.vue` | @headlessui/vue (Dialog) | bg-overlay-scrim, bg-surface/85, backdrop-blur-[20px], shadow-premium, border-line, rounded-lg |
| `GlassListbox.vue` | @headlessui/vue (Listbox) | bg-surface, border-line-strong, shadow-premium, backdrop-blur-[30px], color-accent, shadow-focus-ring |
| `GlassFormField.vue` | Custom | (reads surface/text tokens) |
| `GlassPathField.vue` | Custom | (reads surface/text tokens) |

All primitives use scoped CSS with `var(--color-*)` and `var(--radius-*)` tokens. The refactor would need to touch these scoped styles.

#### 6. Test / Topology / Behavior Surface

**Topology contracts** (8 files in `testing/topology/`):

| Topology | Stable testIds (data-testid) | Refactor Impact |
|----------|------|----------------|
| `activity-bar.topology.ts` | `activity-bar`, `activity-cluster-top`, `activity-cluster-bottom` | Low — structural nav |
| `command.topology.ts` | `app-viewport`, `command-panel`, `command-body`, `command-layout`, `workspace-hierarchy-panel`, `route-body`, `route-actions`, `project-row`, `session-row`, etc. | Medium — layout grid may change |
| `modal.topology.ts` | `modal-root`, `modal-overlay`, `modal-panel`, `modal-title`, `modal-close`, `modal-body` | Low — modal structure stable |
| `terminal.topology.ts` | `terminal-viewport`, `terminal-xterm`, `terminal-shell`, `terminal-xterm-mount`, `terminal-empty-state`, `workspace.quick-actions` | Low — terminal is self-contained |
| `session-status.topology.ts` | `workspace-hierarchy-panel`, `session-status-dot`, plus phase-specific: `session-status-ready`, `session-status-running`, etc. | Medium — status dots may change visually |
| `memory-notification.topology.ts` | `memory-toast-host`, `memory-toast` | Low |
| `provider.topology.ts` | `provider-card`, `provider-card.item`, `provider-radial`, `provider-radial.item` | Medium — selection UI may restyle |
| `archive.topology.ts` | `surface.archive`, `archive.session.row`, `archive.session.restore` | Low |

**Behavior assets** (2 files in `testing/behavior/`):

`session.behavior.ts` defines 10 behaviors:
- `workspace.quickAccess` (risk: medium)
- `session.restore` (risk: high, coverage: critical)
- `session.telemetry.complete` (risk: high, coverage: critical)
- `session.telemetry.blocked` (risk: high, coverage: critical)
- `session.memory-notification` (risk: medium)
- `session.presence.ready/running/complete/blocked/failure` (5 presence states, 3 at risk:high)

`meta-session.behavior.ts` defines 1 behavior:
- `meta-session.read-full-context-and-gate-prompt` (risk: high, coverage: critical)

**Generated Playwright**: `tests/generated/playwright/session-restore.generated.spec.ts` — auto-generated from topology + behavior contracts.

**Test files that directly test UI components** (from git status modified list):
- `AppShell.test.ts`, `GlobalActivityBar.test.ts`, `ArchiveSurface.test.ts`
- `WorkspaceHierarchyPanel.test.ts`, `WorkspaceQuickActions.test.ts`
- `useSidebarPanels.test.ts`

All use `@vue/test-utils` mount with `happy-dom`. Refactor changes to component structure/templates will require updating these tests.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Package versions (Vue 3.5, Pinia 3, Tailwind 4.2, Electron 37) | package.json | `package.json:39–78` |
| Build uses @tailwindcss/vite plugin | electron.vite.config.ts | `electron.vite.config.ts:3,57` |
| 3-column grid layout: 56px / 1fr / auto | AppShell.vue | `AppShell.vue:40` |
| Surface switching: v-show for command, v-if for archive/settings | AppShell.vue | `AppShell.vue:44–71` |
| Design tokens defined in single @theme block with dual light/dark | tailwind.css | `tailwind.css:3–93, 124–217` |
| Radius tokens: lg=12px, md=6px, sm=4px ("Windows 11 Modern Fluent Geometry") | tailwind.css | `tailwind.css:32–34` |
| Font stack: SF Pro Text / Segoe UI Variable + JetBrains Mono / Cascadia Mono | tailwind.css | `tailwind.css:80–81, 96–119` |
| Shared utilities: btn-primary, btn-ghost, settings-card, fluent-bounce | tailwind.css | `tailwind.css:237–340` |
| Design language: Glassmorphism + Clean UI, 4 non-negotiable rules | design-language.md | `design-language.md:1–158` |
| Activity bar: 56px nav with 3 surfaces (command/archive/settings) | GlobalActivityBar.vue | `GlobalActivityBar.vue:30–70, 74` |
| CommandSurface: resizable grid (sessionListWidth | minmax(0,1fr)) | CommandSurface.vue | `CommandSurface.vue:94` |
| RightSidebar: always-mounted, CSS-hides when closed | RightSidebar.vue | `RightSidebar.vue:30–33, 75–87` |
| BaseModal uses @headlessui/vue Dialog + glass tokens | BaseModal.vue | `BaseModal.vue:3–8, 50` |
| GlassListbox uses @headlessui/vue Listbox + scoped glass styles | GlassListbox.vue | `GlassListbox.vue:4–8, 86–184` |
| 8 topology contracts with stable data-testid attributes | testing/topology/*.ts | All 8 files |
| 11 behavior assets (10 session + 1 meta-session) | testing/behavior/*.ts | Both files |
| Generated Playwright spec for session-restore journey | tests/generated/playwright/ | `session-restore.generated.spec.ts` |
| Sidebar panel registry with dynamic component loading | useSidebarPanels.ts | `useSidebarPanels.ts:16–49` |
| TerminalViewport: xterm.js with self-contained scoped styles | TerminalViewport.vue | `TerminalViewport.vue:412–472` |
| Pinia stores: workspaces, sidebar, settings, git, search, memory-notifications, update, observability-view-models | src/renderer/stores/*.ts | 14 store files (8 stores + 6 test files) |

### Risks / Unknowns

- [!] **@headlessui/vue v1.7 → Fluent 2**: If Fluent 2 introduces its own component library (e.g., `@fluentui/vue-components`), the `@headlessui/vue` dependency may need evaluation for removal or coexistence. Headless UI is unstyled by design, so it may coexist with restyled Fluent 2 tokens — but the Dialog/Listbox wrappers in BaseModal and GlassListbox would need restyling regardless.
- [!] **Tailwind 4 @theme token migration**: Fluent 2 tokens may not align 1:1 with the current `--canvas`/`--surface`/`--line` naming. A mapping layer or rename is likely needed in `tailwind.css`.
- [!] **Radius tokens already labeled "Windows 11 Modern Fluent Geometry"** (tailwind.css:31) — the current values (12/6/4px) are close to but may not exactly match Fluent 2 spec (8/4/2px or different tiers). This needs verification against the Fluent 2 design token spec.
- [!] **Shadow system divergence**: Current shadow tokens (glass/soft/card/premium) are multi-layer box-shadows. Fluent 2 uses a different shadow tier system (shadow2 through shadow28). The scoped CSS in primitives (GlassListbox, BaseModal) uses these shadow tokens directly.
- [!] **Glassmorphism mandate vs Fluent 2**: The design-language.md mandates `backdrop-filter: blur(40px)` glass surfaces. Fluent 2 (WinUI 3) uses "Acrylic" and "Mica" materials — these are conceptually similar but implemented differently (Fluent uses layered tint + noise texture). A visual direction decision is needed.
- [?] **Fluent 2 component library choice**: It is unknown whether the refactor will use `@fluentui/vue-components` (Fluent UI React Native/Vue), a CSS-only token approach, or a custom implementation matching Fluent 2 specs. This determines whether the headlessui dependency is replaced or retained.
- [?] **Dark theme alignment**: Current dark theme tokens (tailwind.css:173–217) use a neutral gray (#202020 canvas) palette. Fluent 2 dark mode has specific accent/surface recipes. The extent of token remapping is unknown.
- [?] **Animation system**: Current animations are minimal (`fluent-bounce-in` 0.25s, `fluent-springy` with scale(0.985)). Fluent 2 has specific motion curves (ease-out 0.15s for most, spring for prominent). The refactor scope for motion tokens is unquantified.
- [?] **i18n impact**: `vue-i18n` is used for activity bar labels, terminal empty states, and settings text. A Fluent 2 refactor touching component structure may need to preserve i18n key bindings.

### Component Count by Surface

| Surface | Components | Files |
|---------|-----------|-------|
| Primitives | 4 | BaseModal, GlassListbox, GlassFormField, GlassPathField |
| Command surface | 7 | CommandSurface, WorkspaceHierarchyPanel, WorkspaceQuickActions, TerminalSessionDeck, SessionContextMenu, ProviderFloatingCard, ProviderRadialMenu, HierarchyNode |
| Terminal | 1 | TerminalViewport (self-contained xterm.js) |
| Right sidebar | 4 | RightSidebar, TabBar, FileExplorer, SearchPanel, SourceControlPanel |
| Settings | 5 | SettingsSurface, SettingsTabBar, GeneralSettings, TerminalSettings, ProvidersSettings, AboutSettings |
| Archive | 1 | ArchiveSurface |
| Activity bar | 1 | GlobalActivityBar |
| Title bar | 1 | TitleBar |
| Other | 5 | WorkspaceList, PanelExtensions, UpdatePrompt, InboxQueueSurface, ContextTreeSurface, MemoryToastHost |
| **Total** | **36** | |

### Stores Inventory

| Store | File | Key State |
|-------|------|-----------|
| workspaces | `stores/workspaces.ts` | hierarchy, activeProject, activeSession, sessionPresenceMap |
| sidebar | `stores/sidebar.ts` | open, activeTab, width, sessionListWidth |
| settings | `stores/settings.ts` | terminal settings, resolvedTerminalSettings() |
| git | `stores/git.ts` | source control state |
| search | `stores/search.ts` | search panel state |
| memory-notifications | `stores/memory-notifications.ts` | toast state |
| update | `stores/update.ts` | update prompt state |
| observability-view-models | `stores/observability-view-models.ts` | toSessionRowViewModel, toActiveSessionViewModel |
