---
date: 2026-06-07
topic: Fluent 2 / Windows desktop settings UI best practices
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Fluent 2 Desktop Settings UI Best Practices

### Why This Was Gathered
To inform a design recommendation for improving Stoa's settings/preferences UI. The project's `design-language.md` declares **standard Fluent 2** as visual authority, so any settings UI improvement must align with Fluent 2 / Windows 11 Settings patterns.

### Summary
Fluent 2 settings UI for desktop productivity apps uses a **sidebar navigation + scrollable content panel** layout with **grouped setting cards** (WinUI 3 `SettingsCard` / `SettingsExpander`). Each card presents a single concern with a header, description, and inline action control. The Stoa settings UI already follows this pattern well. The main improvement opportunities are: (1) adopting the official `SettingsExpander` collapsible pattern for dense cards like Terminal settings, (2) adding a settings search bar (Windows 11 parity), and (3) tightening token usage to eliminate hardcoded color values in badges and toggle backgrounds.

---

### Key Findings

#### 1. Navigation Layout: Sidebar + Content Panel (Confirmed Best Practice)

The **left sidebar navigation + right content area** is the canonical Fluent 2 / Windows 11 Settings layout. This is also the pattern used by VS Code, Slack, Discord, Notion, and most modern Electron productivity apps.

**Stoa's current implementation** (`SettingsSurface.vue`) uses exactly this pattern:
- 280px fixed sidebar (left) with `--mica-alt` background
- Scrollable content panel (right) with `--color-surface-solid` background
- Grid layout: `grid-template-columns: 280px minmax(0, 1fr)`
- Responsive collapse at 900px (sidebar stacks on top)

**Verdict**: ✅ Already aligned with Fluent 2 best practice. No layout change needed.

#### 2. SettingsCard / SettingsExpander Pattern (WinUI 3 Official)

Microsoft's official WinUI 3 `SettingsCard` control ([learn.microsoft.com/en-us/windows/apps/design/controls/settings-card](https://learn.microsoft.com/en-us/windows/apps/design/controls/settings-card)) defines:

- **Header** (required): Setting title + optional description
- **Content** (optional): The action control (toggle, dropdown, button, input)
- **Description** (optional): Secondary explanation text
- **Icon** (optional): Left-aligned icon for visual scanning
- **ActionIcon** (optional): Right-aligned action indicator

The `SettingsExpander` ([learn.microsoft.com/en-us/windows/apps/design/controls/settings-expander](https://learn.microsoft.com/en-us/windows/apps/design/controls/settings-expander)) extends SettingsCard with:
- A clickable header that expands/collapses additional content
- Chevron indicator for expandability
- Used when a setting has multiple sub-options or requires explanation

**Stoa's current implementation** already uses a card pattern (`settings-card` class) that closely mirrors the official SettingsCard:
- `.settings-card__header` with title + description + badge → matches SettingsCard header
- Card body contains form fields → matches SettingsCard content area
- `border-radius: var(--radius-lg)`, `background: var(--color-surface-solid)`, `border: 1px solid var(--color-line-strong)` → token-driven, correct

**Gap**: Stoa has no expand/collapse pattern. Dense cards like `TerminalSettings.vue` (4 cards × 3-4 fields each = 14 fields in one scroll) would benefit from `SettingsExpander`-style collapsible sections. The Terminal page is especially long and would benefit from collapsed-by-default sections for advanced options.

**Recommendation**: Consider adding an expand/collapse toggle to `TerminalSettings.vue` cards for Cursor, Scrolling & Display, and Behavior sections (keeping Typography always expanded as the most commonly accessed).

#### 3. Settings Search Bar (Windows 11 Parity)

Windows 11 Settings includes a search bar at the top of the sidebar that filters all settings across categories. This is a key discoverability feature for apps with many settings.

VS Code, JetBrains IDEs, and most modern desktop apps also include settings search.

**Stoa's current implementation**: No search functionality in the settings surface.

**Recommendation**: Add a search input at the top of `settings-surface__nav-panel` (above the section label) that:
- Filters visible settings cards across all tabs
- Shows matching results in the content panel regardless of active tab
- Falls back to the active tab view when search is empty
- Uses `role="search"` and `aria-label` for accessibility

This is a medium-priority improvement — valuable for discoverability but not critical at the current scale of ~20 settings fields.

#### 4. Toggle Switch Implementation (WinUI 3 ToggleSwitch)

The official WinUI 3 `ToggleSwitch` specification:
- 40px (compact) or 52px (standard) width, 20px or 28px height
- On state: accent-colored track, white thumb
- Off state: neutral track with subtle border, white thumb
- Animation: `cubic-bezier(0.25, 0.8, 0.25, 1)` for thumb slide
- Focus: 2px accent outline ring offset by 2px
- `role="switch"` with `aria-checked` for accessibility

**Stoa's current implementation** (`AdvancedSettings.vue`, `ProvidersSettings.vue`):
- 48px × 26px → close to WinUI standard dimensions ✅
- Uses `role="switch"` + `aria-checked` → correct accessibility ✅
- `cubic-bezier(0.25, 0.8, 0.25, 1)` transition → matches WinUI spec ✅
- Focus via `--shadow-focus-ring` → correct ✅
- On state: `var(--color-accent)` background → correct ✅

**Issue**: Off state uses hardcoded `var(--color-black-soft)` + `inset 0 0 0 1px var(--color-line)` instead of the Fluent token `var(--control-fill)` for resting state. Per `design-language.md`, controls should use `var(--control-fill)` for resting and `var(--control-fill-hover)` for hover.

#### 5. Badge / Chip Styling Token Violations

The official Fluent 2 badge/pill pattern uses subtle, token-driven backgrounds. Stoa's `.settings-card__badge` uses:
```css
background: rgba(0, 0, 0, 0.03);
border: 1px solid rgba(0, 0, 0, 0.01);
```

This is a **token violation** — hardcoded `rgba(0, 0, 0, ...)` instead of design tokens. Per `design-language.md` rule 1: *"Do not hardcode colors... when a shared token should be used."*

**Recommendation**: Replace with token-driven values:
```css
background: var(--control-fill);
border: 1px solid var(--stroke-control);
```

Similarly, the toggle resting state (`rgba(0, 0, 0, 0.008)` in `ProvidersSettings.vue:499`) should use `var(--control-fill)`.

#### 6. Form Field Controls: GlassFormField Pattern

The WinUI 3 guidance for settings form fields recommends:
- **Label above, control below** (vertical stacking) for clarity
- Or **label left, control right** (horizontal) for compact layouts
- Select/dropdown should show current value with a subtle chevron
- Text input should have placeholder text and clear focus ring

**Stoa's current implementation** uses `GlassFormField` (a shared primitive) for selects and text inputs. The pattern is consistent across all settings tabs. ✅

#### 7. Responsive Behavior

The official Windows 11 Settings app does NOT collapse the sidebar on resize — it always shows the sidebar. However, for Electron apps running in variable-width windows, responsive collapse is appropriate.

**Stoa's current implementation**: Collapses sidebar below 900px, stacking it vertically. The hero-meta panel hides on mobile. This is a good pattern for an Electron app that may run in split-screen. ✅

#### 8. Accessibility Requirements (WCAG 2.1 / Fluent 2)

Fluent 2 requires:
- All interactive elements must be keyboard-reachable (Tab order follows visual order)
- Focus indicators must be visible (2px+ ring with sufficient contrast)
- Toggle switches must have `role="switch"` + `aria-checked`
- All form fields must have associated labels
- Color must not be the sole indicator of state

**Stoa's current implementation**:
- `role="switch"` + `aria-checked` on toggles ✅
- `aria-label` on cards and sections ✅
- `data-settings-field` attributes for test targeting ✅
- Focus states present via `:focus-visible` ✅

**Gap**: Badge colors alone convey status (detected=green, custom=blue, missing=yellow). This is acceptable for supplementary information but should not be the only way to distinguish states. The badge text ("DETECTED", "CUSTOM", "MISSING") provides the semantic information, so this passes WCAG. ✅

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Sidebar + content panel is canonical Fluent 2 settings layout | Microsoft WinUI 3 Guidelines | https://learn.microsoft.com/en-us/windows/apps/design/controls/settings-card |
| SettingsCard has Header + Content + Description + Icon slots | WinUI 3 SettingsCard API | https://learn.microsoft.com/en-us/windows/apps/design/controls/settings-card |
| SettingsExpander provides collapsible sections | WinUI 3 SettingsExpander API | https://learn.microsoft.com/en-us/windows/apps/design/controls/settings-expander |
| ToggleSwitch specs: 40-52px wide, accent on-state, cubic-bezier transition | WinUI 3 ToggleSwitch | https://learn.microsoft.com/en-us/windows/apps/design/controls/toggle-switch |
| Control tokens: `--control-fill` (rest), `--control-fill-hover`, `--control-fill-active` | Stoa design-language.md | `docs/engineering/design-language.md:36-40` |
| "Do not hardcode colors... when a shared token should be used" | Stoa design-language.md | `docs/engineering/design-language.md:17-19` |
| Hardcoded `rgba(0,0,0,0.03)` in badge background | SettingsSurface.vue / GeneralSettings.vue | Multiple files, `.settings-card__badge` class |
| Hardcoded `rgba(0,0,0,0.008)` in toggle resting state | ProvidersSettings.vue:499, AdvancedSettings.vue:142 | `.settings-toggle` class |
| 280px sidebar + grid layout already implemented | SettingsSurface.vue:106-115 | `.settings-surface__shell` |
| Responsive collapse at 900px | SettingsSurface.vue:205-220 | `@media (max-width: 900px)` |
| 14 terminal settings fields in one scroll (4 cards) | TerminalSettings.vue:119-298 | Full template |
| `role="switch"` + `aria-checked` on toggle switches | AdvancedSettings.vue:53-59, ProvidersSettings.vue | Toggle buttons |
| WinUI 3 spacing: 4px base grid, 8px/12px/16px/24px for section gaps | Fluent 2 Spacing Tokens | https://fluent2.microsoft.design |
| Windows 11 Settings uses search bar for cross-category filtering | Windows 11 UX observation | Canonical in Windows 11 22H2+ |

### Anti-Patterns to Avoid

1. **Modal settings dialogs** — Opening settings in a separate modal window breaks flow. The current in-panel overlay pattern is correct.

2. **Flat list of settings without grouping** — Windows 11 Settings uses categorized cards with headers. Stoa already does this correctly.

3. **Nested navigation (tabs within tabs)** — Avoid a second level of tab navigation inside settings cards. Use expand/collapse (`SettingsExpander` pattern) instead.

4. **Settings that require page reload** — All settings should apply immediately. Stoa's Pinia store pattern already supports this. ✅

5. **Hardcoded pixel colors** — Any `rgba(...)` or `#hex` in component CSS violates the design-language.md mandate. Replace with design tokens.

6. **Overly long scrollable forms** — Terminal settings has 14 fields in one scroll. Use expand/collapse to let users focus on one concern at a time.

7. **Missing undo/reset** — Users should be able to revert individual settings or reset all settings to defaults. Not currently implemented; consider for future iteration.

8. **Decorative animation in settings** — Settings pages should feel "quiet and immediate" per Fluent 2. The current `transition: all 0.2s ease` on cards is appropriate. Do not add entrance animations, stagger effects, or spring physics to settings UI.

9. **Inconsistent card structure** — Each settings card should follow the same Header → Fields → Hints structure. `AdvancedSettings.vue` uses a different header pattern (`.advanced-settings__header` instead of `.settings-panel__header`). This inconsistency should be normalized.

10. **Putting About as a settings tab** — Windows 11 separates "About" into its own section at the bottom of the main Settings list. Many productivity apps (VS Code, Slack) put About in a separate location. The current tab inclusion is acceptable for Stoa's scope but consider moving it to a footer or standalone section as the app grows.

---

### Recommendations Summary

| Priority | Recommendation | Rationale |
|----------|---------------|-----------|
| **High** | Replace hardcoded `rgba(...)` colors in badges and toggles with design tokens | `design-language.md` compliance, theme consistency |
| **High** | Normalize `AdvancedSettings.vue` header pattern to match other tabs | Consistency, maintainability |
| **Medium** | Add expand/collapse to Terminal settings cards | Fluent 2 `SettingsExpander` pattern, reduces scroll fatigue |
| **Medium** | Add settings search bar to sidebar navigation | Windows 11 parity, discoverability |
| **Low** | Consider `SettingsExpander` for Provider cards with conditional sub-options | Cleaner progressive disclosure |
| **Low** | Add "Reset to defaults" button per settings tab | User safety net, common in productivity apps |

### Risks / Unknowns

- [!] The `SettingsExpander` pattern requires custom implementation since Fluent UI Vue (@fluentui/vue) is not used in this project. The current token-first approach means building a collapsible wrapper with `details`/`summary` or a custom Vue component.
- [?] Whether `--control-fill` token produces the exact visual effect currently achieved by `rgba(0, 0, 0, 0.03)`. Need to verify token values in the current theme CSS.
- [?] The sidebar hero-meta panel (`settings-surface__hero-meta`) is a unique Stoa pattern not found in Windows 11 or Fluent 2. Its utility should be validated with users before investing in enhancement.
