# Mobile UI V1 Design Spec

**Date:** 2026-06-19
**Status:** Approved
**Owner:** Stoa

## Summary

Mobile UI V1 introduces a dedicated narrow-screen shell for Stoa. It is not a compressed desktop layout. The mobile experience is a focused drill-down workflow:

```text
Workspace List -> Workspace Session List -> Session Xterm View
```

The mobile shell exists inside the same renderer and reuses the existing store, IPC, session runtime, settings, archive, and terminal infrastructure. It is activated by viewport width and keeps the desktop shell intact for larger screens.

The primary mobile job is remote session pickup: find the right workspace/session, inspect and interact with the session through `xterm.js`, and perform lightweight session management. Desktop workstation capabilities such as IDE launching, file manager launching, right sidebar tools, Explorer, Search, and Git are intentionally excluded from Mobile V1.

## Goals

- Provide a first-class phone UI for Stoa instead of shrinking the desktop three-column shell.
- Make workspace/session selection explicit before entering a session.
- Preserve real terminal interaction by reusing `xterm.js`; do not replace it with a custom chat/input box.
- Add mobile-only connection health so users know whether terminal input/output is reliable.
- Keep mobile interactions lightweight, predictable, and easy to exit.
- Preserve desktop behavior and existing desktop contracts.
- Add dedicated mobile behavior/topology/journey coverage instead of relying on desktop tests.

## Non-Goals

- No PWA or install-to-home-screen support in V1.
- No new authentication system in this work. If auth already exists, mobile maps the existing behavior.
- No desktop-only workstation actions on mobile:
  - no `Open IDE`
  - no `Open File Manager`
  - no `RightSidebar`
  - no Explorer/Search/Git sidebar tools
- No new workspace creation on mobile.
- No mobile-only feature semantics for session type selection. Mobile reuses desktop session type icons and behavior.
- No offline command queue. `Reconnecting` and `Offline` freeze terminal input.
- No single-session health model in V1. Health is global backend health only.

## Hard Constraints

- Follow `docs/engineering/design-language.md`.
- Use Fluent 2 tokens only for color, stroke, radius, material, shadow, typography, and motion.
- Durable mobile app surfaces use `--mica` / `--mica-alt`.
- Dense content, lists, fields, and terminal-adjacent controls use `--surface-solid`.
- Transient layers such as search, sheets, menus, and action sheets use `--acrylic`.
- Modal/blocking dim layers use `--smoke`.
- Terminal colors remain terminal-specific readability tokens.
- Do not introduce Fluent Web Components in this pass.
- Do not modify vendored upstream code under `research/upstreams/evolver`.
- Preserve desktop tests and desktop topology. Mobile gets its own topology where the UX path differs.

## Activation

`MobileAppShell` is enabled when viewport width is `<= 768px`.

The activation signal is viewport width only:

- do not use user agent detection
- do not use touch capability detection
- do not infer from platform

Rationale: Electron windows, browser previews, remote clients, DevTools, and split-screen environments make UA/touch unreliable. Width is the correct layout signal.

## Shell Architecture

Mobile V1 uses an independent `MobileAppShell` branch inside the existing renderer.

Expected structure:

```text
App.vue
  DesktopAppShell / existing AppShell
  MobileAppShell
```

The mobile shell reuses:

- workspace/session Pinia store
- renderer API / IPC
- session runtime and terminal plumbing
- archive restore behavior
- settings store and settings components where practical
- memory notification events

The mobile shell does not render the desktop `GlobalActivityBar`. Mobile expresses `Archive` and `Settings` through the Workspace home tool area.

## Information Architecture

### Primary Flow

```text
Workspace Home
  -> Session List for selected workspace
    -> Full-screen Session Xterm
```

### Startup

Mobile startup always lands on Workspace Home.

It must not auto-enter the last active session. The user can explicitly continue through a `Recent session` entry.

### Back Behavior

- Session view back always returns to that session's owning workspace Session List.
- This is true even when the session was opened from `Recent session` or global search.
- Archive and Settings back return to Workspace Home.
- Search layer dismisses back to the surface that opened it.

## Header Model

All mobile pages use a one-line, minimal header.

Headers are navigation controls, not information-dense summary panels.

### Workspace Home Header

Contains:

- title
- global search entry
- global connection health dot

Does not contain:

- `New workspace`
- `New session`
- desktop activity bar affordances

### Session List Header

Contains:

- back
- workspace name
- local search entry
- `New session`
- global connection health dot

### Session Header

Contains only:

- back
- session name
- session status dot
- `More`
- global connection health dot

It does not permanently show workspace name, provider/model, path, session id, or recent activity. Those belong in `More` or detail/action sheets when needed.

### Archive / Settings Header

Contains:

- back
- title
- global connection health dot

## Workspace Home

Workspace Home is the mobile entry point.

It includes:

- one-line header
- lightweight global search entry
- `Recent session` shortcut
- workspace list
- bottom tool area with `Archive` and `Settings`

It excludes:

- `New workspace`
- `New session`
- inline session lists inside workspace rows

### Workspace Row

Each workspace row shows:

- workspace name
- path or short directory label
- session count summary
- running / blocked counts when available
- recent activity time

Tapping a workspace row opens that workspace's Session List.

## Global Search

Global search is a transient search layer, not a heavy route.

Behavior:

- opened from Workspace Home
- auto-focuses input
- input searches immediately with light debounce
- easy to exit by system back gesture, downward dismissal, or tapping outside where applicable
- close button may exist but must not be the only exit path

Search scope:

- sessions
- workspaces

Result grouping:

```text
Sessions
Workspaces
```

Session results appear before workspace results.

Session result behavior:

- show workspace name, session name, and session status
- prioritize running, blocked, and recent sessions
- tap opens the session directly

Workspace result behavior:

- tap opens that workspace's Session List

Empty query state:

- recent sessions
- recent workspaces

The empty state must not duplicate the full Workspace Home.

## Session List

The Session List is scoped to one workspace.

It shows only unarchived sessions.

Sorting:

1. running / blocked sessions first
2. recently active sessions
3. remaining ready / complete / failure sessions

Each row shows:

- session name
- status dot and status label
- provider/model or runtime type
- recent activity time

Each row does not show:

- last output summary
- path
- session id
- multiple inline management buttons

Interaction:

- tapping the row enters the Session Xterm View
- one `More` affordance opens low-frequency session actions

### Session List Search

Session List has a local search affordance.

Behavior:

- searches only sessions in the current workspace
- combines with status filters
- should be lightweight and not dominate the header

### Status Filters

Session List includes lightweight status chips:

```text
All / Running / Blocked / Recent
```

These are filters, not navigation tabs.

## New Session

Mobile allows creating a new session, but only from a workspace Session List.

`New session` is not available on Workspace Home or inside global search.

Flow:

```text
Session List -> New -> Session Type Sheet -> Create -> Session Xterm View
```

Creation behavior:

- user must select a session type before creation
- no default immediate creation
- successful creation automatically opens the new session

### Session Type Sheet

The sheet:

- is a bottom sheet
- uses a grid layout
- displays pure session type icons, matching desktop
- strictly reuses desktop session type icon set and behavior
- does not add mobile-only availability messaging, disabled reasons, configuration flows, or long descriptions unless desktop already has them

Visual labels may stay hidden if desktop uses pure icons, but semantic labels must remain available through existing accessibility/title/aria behavior where already present.

## Session Xterm View

The Session Xterm View is the core mobile work surface.

It contains:

- one-line session header
- full-screen `xterm.js` terminal
- right-side `Keys` handle
- optional right-side vertical key rail
- connection health banner when needed
- memory banner when needed

It does not contain:

- custom chat-style input box
- desktop quick action strip
- Open IDE / Open File Manager
- RightSidebar / Explorer / Search / Git

### Xterm Interaction

Mobile uses direct `xterm.js` interaction.

The implementation must not replace terminal input with a custom agent prompt/input field.

Only `Connected` health allows xterm input. `Reconnecting` and `Offline` freeze input but still allow:

- viewing existing output
- scrolling
- selecting text
- copying selected text
- returning to lists

No offline queue is allowed in V1.

### Terminal Display Preferences

Default display:

- fit to phone width
- wrap lines enabled

Wide-output support:

- users can switch display mode for tables and wide command output
- horizontal scroll mode is allowed

Preferences:

- `Wrap lines`
- `Horizontal scroll`
- `Text size`

Storage:

- persisted per `sessionId`
- scoped to mobile terminal display
- does not affect backend session runtime

Location:

- `Session More -> Display`

## Keys Handle And Key Rail

Mobile terminal input needs explicit, reliable auxiliary keys.

The right edge always shows a thin `Keys` handle.

Behavior:

- tap `Keys` to expand the key rail
- tap `Keys` again to collapse
- tap outside the rail to collapse
- no timeout-based auto-hide
- no automatic expansion on xterm focus or keyboard open
- no pin mode in V1

The key rail:

- is vertical
- appears on the right side
- overlays the terminal
- does not resize xterm
- does not trigger terminal column recalculation
- has fixed width/height behavior
- scrolls vertically if content overflows

Key order from top to bottom:

```text
Esc
Tab
Up
Down
/
-
Copy
Paste
Enter
```

Key semantics:

- `Copy` copies the currently selected xterm text to the mobile clipboard.
- `Paste` reads the mobile clipboard and writes the content into xterm.
- `Copy` is not interrupt.
- `Paste` is not a raw `Ctrl+V` sequence.
- interrupt/stop/session lifecycle controls live in `More`, not in the key rail.

## Session More

The Session header keeps one `More` entry for low-frequency actions.

`More` opens a mobile action sheet.

It may expose existing desktop-backed session management actions such as:

- archive
- restart
- delete if desktop already exposes it
- copy session id
- copy workspace path
- display preferences

Mobile must not invent new management semantics that do not exist on desktop, except for mobile display preferences and health presentation defined in this spec.

## Archive

Archive is a standalone mobile page.

Entry:

- Workspace Home bottom tool area

Behavior:

- shows archived sessions
- preserves restore capability
- restore automatically opens the restored session in Session Xterm View

Archive content should remain a management surface, not a second primary session list.

## Settings

Settings is a standalone mobile page.

Entry:

- Workspace Home bottom tool area

Behavior:

- preserves all desktop settings capabilities
- changes layout only
- uses top horizontal chips/tabs for settings sections
- remains token-first and Fluent 2 aligned

Settings must not drop desktop settings categories in V1.

## Memory Notification

Mobile preserves memory notification behavior.

Presentation:

- top lightweight banner
- does not cover terminal input
- does not conflict with the right-side key rail

The existing memory event semantics remain unchanged.

## Connection Health

Mobile requires explicit connection health. This is a mobile V1 requirement even if desktop does not currently expose the same surface.

Connection health is transport/backend health, not session business state.

Health states:

```text
Connected
Reconnecting
Offline
```

It is separate from session status:

```text
ready / running / blocked / complete / failure
```

### Health Source

Add a backend health API.

The renderer must not infer health from incidental UI events, session events, or random IPC failures.

Health API scope:

- global backend health
- core session service availability

Health API does not check:

- each session's PTY liveness
- each provider's agent state
- individual session business status

### Polling Policy

Foreground:

- poll every `5s`

Failure/retry:

- on failure, enter `Reconnecting`
- retry every `2s`
- after continuous failure longer than `15s`, enter `Offline`

Visibility:

- when page/app becomes visible, check immediately
- hidden pages may slow to `30s` or pause polling

### UX

All mobile headers show a small health dot.

For `Reconnecting` and `Offline`:

- show top lightweight banner
- freeze xterm input
- allow view/scroll/copy
- provide a `Retry` icon/action

`Retry` only triggers an immediate health check. It must not restart a session or mutate business state.

## Landscape

V1 is portrait-first.

Required landscape behavior:

- no broken layout
- no incoherent overlap
- session header remains usable
- xterm remains visible
- `Keys` handle remains reachable
- banners do not block core controls

V1 does not require a bespoke landscape IA.

## Accessibility And Touch

Minimum touch target:

- use `44px` as the mobile web baseline

Requirements:

- icon-only controls need accessible names
- connection status must not be color-only
- status dots should keep textual/attribute status equivalents for tests and accessibility
- focus states use shared tokens
- no hover-only critical actions on mobile

## Mobile Topology Requirements

Mobile gets dedicated topology instead of forcing desktop selectors into a different IA.

Recommended stable test ids:

```text
mobile-shell
mobile-health-dot
mobile-health-banner
mobile-health-retry
mobile-workspace-home
mobile-global-search-trigger
mobile-global-search-layer
mobile-global-search-input
mobile-global-search-session-result
mobile-global-search-workspace-result
mobile-recent-session
mobile-workspace-row
mobile-tool-archive
mobile-tool-settings
mobile-session-list
mobile-session-search-trigger
mobile-session-search-input
mobile-session-filter-all
mobile-session-filter-running
mobile-session-filter-blocked
mobile-session-filter-recent
mobile-session-row
mobile-session-row-more
mobile-new-session
mobile-new-session-sheet
mobile-session-type-option
mobile-session-view
mobile-session-header
mobile-session-more
mobile-session-actions-sheet
mobile-terminal-display-sheet
mobile-keys-handle
mobile-keys-rail
mobile-key-esc
mobile-key-tab
mobile-key-up
mobile-key-down
mobile-key-slash
mobile-key-dash
mobile-key-copy
mobile-key-paste
mobile-key-enter
mobile-archive
mobile-archive-row
mobile-archive-restore
mobile-settings
mobile-settings-tabs
mobile-memory-banner
```

Exact ids can change during implementation, but the topology must cover the above surfaces and behaviors.

## Behavior Coverage

Add mobile behavior assets for:

- mobile app enters Workspace Home at startup
- workspace row opens Session List
- session row opens Session Xterm View
- Recent session opens Session Xterm View directly
- global search opens as a transient layer and exits lightly
- global search groups sessions and workspaces
- session result opens Session Xterm View directly
- workspace result opens Session List
- Session List local search combines with status filters
- New session sheet uses desktop session type icons and creates into Session Xterm View
- Session Xterm View uses xterm, not custom input
- key handle expands/collapses key rail
- key rail sends terminal keys and handles Copy/Paste semantics
- display preferences persist by `sessionId`
- archive restore opens restored session
- settings mobile layout preserves settings categories
- memory notification appears as mobile banner
- `Connected` allows terminal input
- `Reconnecting` freezes terminal input and shows retry banner
- `Offline` freezes terminal input and shows retry banner
- `Retry` calls health check only

## Implementation Plan

### 1. Backend health contract

- Add global backend health API.
- Expose it through IPC/preload renderer API.
- Add core tests for health success/failure.
- Add renderer tests for health state transitions.

### 2. Shell split

- Add viewport detection for `<=768px`.
- Render existing desktop shell above that threshold.
- Render `MobileAppShell` at or below that threshold.
- Keep desktop activity bar and desktop right sidebar out of mobile shell.

### 3. Mobile state machine

Implement mobile navigation state:

```text
workspace-home
session-list
session-view
archive
settings
global-search-layer
new-session-sheet
action-sheets
```

Navigation must preserve direct routes back to the owning workspace Session List.

### 4. Mobile surfaces

Implement:

- Workspace Home
- Global Search Layer
- Session List
- New Session Sheet
- Session Xterm View
- Archive
- Settings
- Health Banner
- Memory Banner
- Keys Handle / Key Rail

### 5. Terminal display preferences

- Persist preferences by `sessionId`.
- Apply wrap/horizontal-scroll/text-size mode to mobile terminal presentation.
- Do not mutate backend runtime settings.

### 6. Test assets

- Add mobile topology.
- Add mobile behavior specs.
- Add mobile journeys.
- Regenerate generated Playwright files.
- Keep desktop generated journeys passing.

## Verification

Mandatory commands:

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

Viewport acceptance:

```text
390 x 844
360 x 800
844 x 390
1280 x 800 desktop regression
```

Acceptance criteria:

- mobile starts on Workspace Home
- no automatic session entry at startup
- global search is transient and easy to exit
- session creation requires type selection and then opens new session
- xterm remains the primary input surface
- key rail overlays without resizing xterm
- desktop quick actions are absent on mobile
- right sidebar is absent on mobile
- health states correctly gate input
- archive restore opens restored session
- settings preserve desktop capabilities
- desktop shell remains unchanged at desktop viewport

## Risks

- Terminal input gating must not break desktop xterm input.
- Key rail overlay must not cause xterm column recalculation.
- Health polling must avoid noisy state flapping.
- Mobile topology must not invalidate existing desktop topology assumptions.
- Session type sheet must reuse desktop behavior exactly enough to avoid creating a second session creation model.
- Per-session display preferences need clear ownership so they do not collide with global terminal settings.

## Open Items

No product decisions remain open for V1. Implementation may still refine component boundaries and exact topology ids while preserving this spec's behavior.
