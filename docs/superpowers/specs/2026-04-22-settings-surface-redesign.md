# Settings Surface Redesign

**Date**: 2026-04-22
**Status**: Draft
**Scope**: Replace settings placeholder in AppShell with a full settings surface

## Problem

The settings surface in `AppShell.vue` (lines 45–51) is a static placeholder. The activity bar already has a ⚙ button wired to switch to the `settings` surface, but no actual settings UI exists. The app also lacks:

- Any settings data model, IPC channels, or persistence mechanism
- A system-native folder/file picker (current path inputs require manual typing)
- Auto-detection for shell and provider binaries

## Design Principles

Following the project's "extreme simplicity" philosophy:

1. **Decide for users where possible** — auto-detect shell, auto-detect providers, pick good defaults
2. **Expose only what's necessary** — shell path, font size, provider paths
3. **Match existing design language** — Modern Minimalist Glassmorphism, all tokens from `styles.css`
4. **Native interactions** — Electron `dialog.showOpenDialog` for path selection, not text inputs

## Settings Categories

Three horizontal tabs inside the glass viewport:

| Tab | Purpose |
|---|---|
| General | Shell path (auto-detect + browse), terminal font size |
| Providers | Binary paths per provider (auto-detect + browse) |
| About | App version, tech stack, links |

No data directory setting. No theme/appearance settings — the design IS the identity.

## Architecture

### Component Tree

```
AppShell.vue
├── GlobalActivityBar.vue (unchanged)
└── app-shell__viewport
    ├── CommandSurface.vue (unchanged)
    └── SettingsSurface.vue ← replaces placeholder
        ├── SettingsTabBar.vue ← horizontal tab navigation
        └── <component :is="currentTab">
            ├── GeneralSettings.vue
            ├── ProvidersSettings.vue
            └── AboutSettings.vue
```

### New Files

| File | Purpose |
|---|---|
| `src/renderer/components/settings/SettingsSurface.vue` | Root settings container, manages active tab |
| `src/renderer/components/settings/SettingsTabBar.vue` | Horizontal tab bar with 3 tabs |
| `src/renderer/components/settings/GeneralSettings.vue` | Shell path + font size form |
| `src/renderer/components/settings/ProvidersSettings.vue` | Provider binary path list |
| `src/renderer/components/settings/AboutSettings.vue` | Version + tech stack + links |
| `src/renderer/stores/settings.ts` | Pinia store for settings state |
| `src/core/settings-detector.ts` | Auto-detection logic for shell + providers |

### Modified Files

| File | Change |
|---|---|
| `src/renderer/components/AppShell.vue` | Replace placeholder with `SettingsSurface` |
| `src/renderer/app/App.vue` | Mount settings store, trigger `loadSettings()` |
| `src/renderer/styles.css` | Add settings-specific CSS classes |
| `src/core/ipc-channels.ts` | Add `settings:get`, `settings:set`, `dialog:pick-folder`, `dialog:pick-file`, `settings:detect-shell`, `settings:detect-provider` |
| `src/core/state-store.ts` | Add `settings` field to persisted state |
| `src/core/project-session-manager.ts` | Read/write settings alongside app state |
| `src/preload/index.ts` | Expose new APIs: `getSettings`, `setSetting`, `pickFolder`, `pickFile`, `detectShell`, `detectProvider` |
| `src/shared/project-session.ts` | Add `AppSettings` type, extend `RendererApi` |
| `src/main/index.ts` | Register new IPC handlers |
| `src/renderer/components/command/NewProjectModal.vue` | Replace path text input with Browse button |

## Data Model

### AppSettings

```typescript
interface AppSettings {
  shellPath: string           // Empty string = auto-detect
  terminalFontSize: number    // 12–24, default 14
  providers: Record<string, string>  // providerId → binary path, empty = auto-detect
}
```

### Persistence

Settings stored in `~/.stoa/state.json` alongside existing `PersistedAppStateV2`:

```typescript
interface PersistedAppStateV2 {
  // ... existing fields ...
  settings: AppSettings
}
```

### New IPC Channels

| Channel | Direction | Payload | Response |
|---|---|---|---|
| `settings:get` | renderer→main | — | `AppSettings` |
| `settings:set` | renderer→main | `{ key: string, value: unknown }` | `void` |
| `dialog:pick-folder` | renderer→main | `{ title?: string }` | `string \| null` |
| `dialog:pick-file` | renderer→main | `{ title?: string, filters?: FileFilter[] }` | `string \| null` |
| `settings:detect-shell` | renderer→main | — | `string \| null` |
| `settings:detect-provider` | renderer→main | `{ providerId: string }` | `string \| null` |

## UI Design

### Tab Bar

- Container: `border-bottom: 1px solid var(--line)`, `padding: 0 20px`
- Tab buttons: `background: transparent`, `color: var(--muted)`, `padding: 12px 16px`
- Active tab: `color: var(--text-strong)`, bottom `2px solid var(--accent)` indicator
- Hover: `background: var(--black-soft)`, `transition: all 0.2s ease`
- Font: `var(--font-ui)`, `font-size: 12px`, `font-weight: 500`

### General Tab

**Shell Path:**
- Label: eyebrow style (`font-size: 10px`, `font-weight: 600`, `color: var(--muted)`, uppercase)
- Input row: flex layout with `.form-field__input` + `button-ghost` Browse button
- Auto-detection hint below input: `font-family: var(--font-mono)`, `font-size: 10px`, `color: var(--muted)`
  - When auto-detected: `Auto-detected: /bin/zsh ✓` with `var(--success)` checkmark
  - When custom: `Custom path`
  - When empty field: auto-detection activates
- On mount: call `detectShell()`, fill if field is empty

**Terminal Font Size:**
- Use `GlassFormField` component with `type="select"`
- Options: 12px through 24px
- Default: 14px

### Providers Tab

- Dynamically render provider cards from registered providers (read from `src/extensions/`)
- Each provider card:
  - Eyebrow label with provider name (uppercase, muted)
  - Path input row: `.form-field__input` + `button-ghost` Browse button
  - Auto-detection status below:
    - Found: `Auto-detected ✓` in `var(--success)` color
    - Not found: `Not found — click Browse to locate` in `var(--warning)` color
- Cards separated by `1px solid var(--line)` divider
- On mount: batch call `detectProvider(id)` for each provider

### About Tab

- Centered layout, `max-width: 360px`, `margin: auto`
- Brand mark: reuse ActivityBar "V" logo style (24×24, dark bg, white text)
- App name: `font-size: 16px`, `font-weight: 600`, `color: var(--text-strong)`
- Version: `font-family: var(--font-mono)`, `font-size: 12px`, `color: var(--muted)`, from `package.json` via IPC
- Divider: `1px solid var(--line)`, `margin: 16px 0`
- Tech stack: `font-size: 11px`, `color: var(--muted)`, items joined by `·`
- Links: `font-size: 11px`, `color: var(--accent)`, hover underline

### Settings Card Layout

- Content area: `padding: 0`, `max-width: 640px`, centered
- Each setting item: `padding: 16px 20px`
- Item separator: `border-bottom: 1px solid var(--line)` (last item has no border)
- Background: transparent (inherits from glass viewport)

### Responsive (≤960px)

- Tab bar switches to icon mode: ⚙ General, 🔧 Providers, ℹ About
- Content area: full width, no max-width constraint

## Auto-Detection Logic (`settings-detector.ts`)

### Shell Detection (platform-aware)

- **Windows**: Check `COMSPEC` env var → fallback to `powershell.exe`
- **macOS/Linux**: Check `SHELL` env var → fallback to `/bin/bash`
- Validate path exists via `fs.existsSync`

### Provider Detection

- For each registered provider, check common install locations:
  - **Windows**: `%LOCALAPPDATA%\Programs\`, `%PROGRAMFILES%\`, PATH lookup via `which`/`where`
  - **macOS/Linux**: `/usr/local/bin/`, `/opt/homebrew/bin/`, PATH lookup via `which`
- Return first found path or `null`

## NewProjectModal Improvement

Replace the path text input in `NewProjectModal.vue` with:
- Read-only input showing selected path
- "Browse" button calling `window.stoa.pickFolder({ title: 'Select Project Directory' })`
- On selection: fill the path field with the returned value

This applies the same `pickFolder` mechanism used in settings, making path selection consistent across the app.

## Test Requirements

Following AGENTS.md test architecture:

### Tier 1: Unit Tests
- `src/renderer/stores/settings.test.ts` — Pinia store: load, update, persistence
- `src/core/settings-detector.test.ts` — Shell/provider detection with mocked `fs` and `process.env`

### Tier 2: E2E Tests
- `tests/e2e/settings-surface.test.ts` — Full pipeline: IPC round-trip, state persistence, auto-detection mocking
- Update `tests/e2e/ipc-bridge.test.ts` — Add new IPC channel round-trips
- Update `tests/e2e/main-config-guard.test.ts` — Verify new channel registrations use constants

### Tier 3: Component Tests
- `src/renderer/components/settings/SettingsSurface.test.ts` — Tab switching, surface mounting
- `src/renderer/components/settings/GeneralSettings.test.ts` — Form interactions, auto-detect display
- `src/renderer/components/settings/ProvidersSettings.test.ts` — Provider list rendering, browse actions
- `src/renderer/components/settings/AboutSettings.test.ts` — Version display, link rendering
