# Settings UI Refresh Design

## Summary

This pass refreshes the existing settings surface without replacing its overall information architecture. The approved direction is to keep the current left navigation and right content panel, add a lightweight search affordance, normalize settings cards to a Fluent 2 token-first pattern, and reduce terminal-page scroll fatigue with collapsible sections.

## Goals

- Improve discoverability inside the current settings surface.
- Remove remaining hardcoded visual values from the settings cluster.
- Make high-density settings sections easier to scan and use.
- Preserve existing `data-testid` and `data-settings-*` contracts unless a new contract is explicitly added.

## Non-Goals

- No Fluent UI component dependency.
- No settings modal/window rewrite.
- No upstream changes under `research/upstreams/evolver`.
- No compatibility layer for old token names or old settings behavior.

## Constraints

- Follow [docs/engineering/design-language.md](/D:/Data/DEV/ultra_simple_panel/docs/engineering/design-language.md:1) and the canonical `--color-*` token family.
- Preserve the existing settings tabs: General, Terminal, Providers, Advanced, About.
- Respect the current workspace’s pending `AboutSettings` update-flow changes.
- Quality gates remain mandatory: `npm run test:generate`, `npm run typecheck`, `npx vitest run`, `npm run test:e2e`, `npm run test:behavior-coverage`.

## UX Decisions

### 1. Keep the shell, simplify tab ownership

`SettingsSurface.vue` remains the entry surface, but tab ownership moves fully into local Vue state instead of the current mixed HeadlessUI/manual model. The left rail remains the same structural pattern:

- title and explanatory copy
- search input
- section list
- active section summary

The right panel renders the active settings view directly from the selected tab id.

### 2. Lightweight search, not a cross-surface search results page

Search is intentionally bounded:

- it matches tab labels, summaries, and curated per-tab keywords
- it auto-focuses the first matching tab when the current tab no longer matches
- it keeps the existing tab-based mental model
- it filters cards inside tabs that opt into section-level matching

This avoids turning settings into a flattened results page while still improving discoverability.

### 3. SettingsCard normalization

The shared visual pattern across General, Terminal, Providers, Advanced, and About should converge on one Fluent 2 card language:

- durable shell surfaces use Mica/Mica-alt
- content cards use `--color-surface-solid`
- borders use `--stroke-divider` / `--stroke-control`
- toggles use control-fill tokens rather than bespoke `rgba(...)`
- hover states use token-derived accent tinting rather than raw colors

### 4. Terminal uses progressive disclosure

`TerminalSettings.vue` becomes the density relief valve for the entire settings surface:

- Typography stays always visible.
- Cursor, Scrolling and display, and Behavior become collapsible sections.
- A search hit on a collapsed section forces it open while the query is active.

This matches the Fluent `SettingsExpander` pattern without adding a dependency.

## Component Map

- `SettingsSurface.vue`
  - owns `activeTab` and `searchQuery`
  - computes visible tabs
  - renders the active tab component directly
- `SettingsTabBar.vue`
  - becomes a pure presentational tab list driven by parent-provided tab metadata
- `TerminalSettings.vue`
  - accepts `searchQuery`
  - manages local expanded section state
  - filters visible cards by section keywords
- `GeneralSettings.vue`
  - accepts `searchQuery`
  - filters visible cards by section keywords
- `ProvidersSettings.vue`
  - accepts `searchQuery`
  - filters visible cards by section keywords
- `AdvancedSettings.vue`
  - accepts `searchQuery`
  - keeps the `stoa-ctl` contract intact
- `AboutSettings.vue`
  - accepts `searchQuery`
  - keeps the in-progress update action behavior intact while aligning card tokens
- `settings-search.ts`
  - shared helper for query normalization and keyword matching

## Data Flow

- `SettingsSurface` passes `searchQuery` down as a prop.
- Each tab decides whether a card should render using a shared text-match helper and a local keyword list.
- Search does not mutate settings state; it only affects visibility and active-tab selection.
- Settings writes continue to flow through `useSettingsStore`.

## Testing Strategy

- Add unit coverage for the new shell behavior:
  - search input render
  - tab filtering / fallback active-tab selection
- Add unit coverage for terminal expanders and section filtering.
- Update existing tests only where labels or contract attributes change.
- Extend Playwright settings coverage to exercise the search field and collapsed terminal sections if needed.

## Risks

- The current worktree already contains `AboutSettings` behavior changes; style cleanup there must not regress update actions.
- Replacing the tab shell behavior is a real behavior change, so tests must cover it directly instead of relying only on Playwright.
- Search scope must stay curated. If it starts trying to index every individual field label dynamically, the complexity will outrun the benefit.
