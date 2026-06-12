---
date: 2026-06-07
topic: terminal-sidebar-ui-audit
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Terminal Page Right Sidebar UI/UX Audit

### Why This Was Gathered
Audit the terminal page right sidebar's current UI/UX state against the project's `docs/engineering/design-language.md` (Modern Minimalist Glassmorphism + Clean UI). Evaluate usability, hierarchy, density, empty states, error states, keyboard/accessibility, and responsiveness.

### Summary
The right sidebar uses a 3-panel tab system (Explorer, Search, Git) managed by `RightSidebar.vue` + `TabBar.vue` + a Pinia store. Token usage is **mostly compliant** with the Fluent 2 design language, but there are **systemic violations**: pervasive inline `mouseenter/mouseleave` style manipulation instead of CSS hover classes, one hardcoded `rgba()` value, and inconsistent use of `--control-fill` / `--stroke-control` / `--stroke-divider` tokens. Accessibility has a solid baseline (`aria-current`, `aria-label`, keyboard shortcuts, `data-testid`) but gaps exist: no `role="tablist"/"tab"/"tabpanel"`, no `focus-visible` rings on interactive elements, and no ARIA live regions for dynamic content.

### Key Findings

#### 1. Inline Hover Style Manipulation — Design Language Violation (Systemic)

Every interactive element across all three panels uses inline JavaScript `mouseenter`/`mouseleave` handlers to toggle `style.background` and `style.color`. This violates the design language rule to "build hierarchy through tokens, not decoration" and makes hover states invisible to CSS `@media (hover: hover)` and `focus-visible`.

**Pattern (repeated ~40+ times):**
```html
@mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--color-black-soft)'"
@mouseleave="($event.currentTarget) as HTMLElement).style.background = ''"
```

**Affected files:**
- `RightSidebar.vue:61` (close button)
- `TabBar.vue:57-58` (tab buttons)
- `FileExplorer.vue:472-473, 484-485, 497-498, 508-509, 548-549` (toolbar buttons, tree rows)
- `SearchPanel.vue:106-107, 190-191, 215-216` (search button, file rows, match rows)
- `SourceControlPanel.vue:160-161, 181-182, 193-194, 205-206, 216-217, 228-229, 242-243, 251-252, 259-260, 324-325, 338-339, 367-368, 381-382, 421-422, 436-437, 465-466, 477-478, 352-353, 395-396, 406-407, 446-447` (every button and row)

**Why it's a problem:**
- Bypasses CSS specificity and `@media (prefers-reduced-motion)`
- No `focus-visible` ring equivalent
- Massive template bloat (each element has 2-4 extra event handler attributes)
- Impossible to theme/override globally
- Violates design-language.md Rule 3: "Hierarchy should come from material role, spacing, type weight, stroke tokens, restrained Fluent elevation, selected and focus states"

#### 2. Hardcoded `rgba()` in Drop Target — Token Violation

`FileExplorer.vue:746-749`:
```css
.explorer-row-drop-target {
  background: rgba(59, 130, 246, 0.1) !important;
  outline: 1px dashed var(--color-accent);
}
```
The `rgba(59, 130, 246, 0.1)` is a hardcoded blue that bypasses the token system. Design language Rule 1 states: "Do not hardcode colors, shadows, radii, stroke widths, material fills, or motion timings in component styles when a shared token should be used."

#### 3. Inconsistent Border/Stroke Tokens

The design language specifies:
- `var(--stroke-control)` for control boundaries
- `var(--stroke-divider)` for layout separators

Current usage uses `var(--color-line)` for all borders (separators, inputs, context menus). While `--color-line` maps to `var(--line)` which is defined in the token system, it does not match the design-language-recommended `--stroke-control` / `--stroke-divider` split.

**Instances:**
- `RightSidebar.vue:52` — `border-l border-[var(--color-line)]`
- `TabBar.vue:44` — `border-b` with `border-color: var(--color-line)`
- `FileExplorer.vue:464` — toolbar separator
- `FileExplorer.vue:596` — inline input border uses `var(--color-accent)` (intentional for focus)
- `SearchPanel.vue:87` — search area separator
- `SourceControlPanel.vue:134, 151, 271, 281` — panel sections

This is a minor concern — `--color-line` exists in the token system — but the semantic split between "control boundary" and "structural divider" is lost.

#### 4. Accessibility: Missing ARIA Roles for Tab Interface

The tab bar and panels lack proper ARIA tab semantics:

**TabBar.vue:**
- Container `<div>` has no `role="tablist"`
- Tab buttons have `aria-current="true"` but lack `role="tab"` and `aria-selected`
- No `aria-controls` linking tabs to panels

**RightSidebar.vue:**
- Panel container has no `role="tabpanel"`
- No `aria-labelledby` linking panels to tabs
- Tab switching has no `aria-orientation="horizontal"`

**Keyboard navigation:**
- Arrow key navigation between tabs is not implemented (only click)
- `useSidebarShortcuts.ts` provides Ctrl+Shift+E/F/G shortcuts but no in-tab-bar keyboard nav

#### 5. No `focus-visible` Rings on Interactive Elements

The design language defines `--shadow-focus-ring` (mapped to `--shadow-focus-ring-val`) for keyboard focus indication. The `btn-primary` and `btn-ghost` utility classes both include `&:focus-visible { box-shadow: var(--shadow-focus-ring) }`.

However, **no interactive element in the right sidebar** uses these utilities or implements `focus-visible`:
- Tab buttons, close button, toolbar buttons, tree rows, context menu items, commit button, search filters, branch dropdown items — none show a focus ring when keyboard-navigated.

This is a significant accessibility and design language compliance gap.

#### 6. Empty States Are Present But Inconsistent

| Panel | Empty State | Text | Location |
|-------|-------------|------|----------|
| FileExplorer — no project | ✅ | "No active project" | `FileExplorer.vue:515` |
| FileExplorer — loading | ✅ | "Loading..." | `FileExplorer.vue:519` |
| FileExplorer — empty dir | ✅ | "Empty directory" | `FileExplorer.vue:605` |
| Search — initial | ✅ | "Search across files" | `SearchPanel.vue:234` |
| Search — no results | ✅ | "No results found" | `SearchPanel.vue:175` |
| Search — searching | ✅ | "Searching..." | `SearchPanel.vue:167` |
| Search — error | ✅ | Shows `error` message in `var(--color-error)` | `SearchPanel.vue:171` |
| Git — no project | ✅ | "No active project" | `SourceControlPanel.vue:306` |
| Git — loading | ✅ | "Loading..." | `SourceControlPanel.vue:310` |
| Git — no changes | ✅ | "No changes detected" | `SourceControlPanel.vue:455` |
| Git — operation error | ✅ | Error banner with dismiss (auto-dismiss 8s) | `SourceControlPanel.vue:271-279` |
| Git — truncated results | ⚠️ | "Results truncated..." in SearchPanel only | `SearchPanel.vue:229` |

**Gaps:**
- No icon/illustration in any empty state — all are plain text only
- Git panel's error state uses `var(--color-error)` text but has no `role="alert"` or `aria-live="polite"` for screen readers
- Search panel's `error` display lacks any structured error state (just a paragraph)

#### 7. Material Usage Compliance

| Element | Current Material | Design Language Expectation | Compliant? |
|---------|------------------|---------------------------|------------|
| Sidebar background | `bg-mica` | Mica for durable app surfaces | ✅ |
| Sidebar border | `border-[var(--color-line)]` | Stroke divider token | ⚠️ Close |
| Tab bar separator | `border-b` + `--color-line` | Stroke divider | ⚠️ Close |
| Context menu | `--color-surface-solid` + `--shadow-soft` | Acrylic for transient overlays | ❌ Should be `--acrylic` |
| Branch dropdown | `--color-surface-solid` | Acrylic for transient | ❌ Should be `--acrylic` |
| Git dialogs (Teleport) | `--acrylic` + `backdrop-filter: blur(20px)` | Acrylic for transient | ✅ |
| Dialog backdrop | `--smoke` | Smoke for modal blocking | ✅ |
| Search input | `--color-surface-solid` | Surface solid for form fields | ✅ |
| Commit textarea | `--color-surface-solid` | Surface solid for form fields | ✅ |
| File tree rows | No explicit bg (inherits mica) | Mica for durable surface | ✅ |

**Violations:** The context menu (`FileExplorer.vue:613-715`) and branch dropdown (`SourceControlPanel.vue:149-172`, more menu `233-261`) use `var(--color-surface-solid)` with `box-shadow: var(--shadow-soft)`. Design language Rule 2 says Acrylic is for "transient, light-dismiss surfaces" including context menus, flyouts, and popovers.

#### 8. Density & Layout Analysis

**Sidebar default width:** 280px (min 220, max 800) — `sidebar.ts:6-8`

**Row heights:**
- Toolbar buttons: 24px (h-6) — compact but functional
- Tab bar buttons: `px-2.5 py-1.5` ≈ 28px — good for 13px font
- File tree rows: 28px fixed height — matches VS Code density
- Git file entries: 24px fixed height — slightly tighter than explorer
- Search match rows: 24px min-height — good

**Padding/spacing:**
- Toolbar: `px-2 py-1.5` — tight, 8px horizontal
- Tree rows: `px-2` with depth-based left padding (16px per level + 8px base)
- Panel content: `px-2` horizontal padding — consistent across panels

**Assessment:** Density is consistent and appropriate for a code tool sidebar. The 280px default is slightly narrower than VS Code's 300px but still functional. The resize handle (220-800px range) provides good flexibility.

#### 9. Motion & Transition Compliance

**Design language specifies:**
- `var(--duration-rest)` (150ms) for ordinary hover/state changes
- `var(--duration-emphasized)` (250ms) for overlays/surface transitions
- `var(--curve-standard)` for ordinary changes
- `var(--curve-decelerate)` for entering surfaces

**Current usage:**
- `RightSidebar.vue:86` — `transition: width 0.2s ease, opacity 0.2s ease` — uses hardcoded `0.2s` instead of `var(--duration-rest)` or `var(--duration-emphasized)` and `ease` instead of `var(--curve-standard)`
- `TabBar.vue:51` — `transition-all duration-200` — hardcoded 200ms Tailwind class
- `RightSidebar.vue:47` — resize handle uses `transition-colors` (Tailwind default, ~150ms)
- `FileExplorer.vue:728` — context menu `transition: background 0.15s ease` — hardcoded

**Verdict:** Close to spec but uses hardcoded values instead of motion tokens. Minor violation.

#### 10. Typography Compliance

| Usage | Current | Design Language Expectation | Compliant? |
|-------|---------|----------------------------|------------|
| Tab labels | `var(--text-caption)` (11px), `font-medium` | UI font for labels | ✅ |
| File names | `var(--text-body-sm)` (13px), `var(--font-ui)` | UI font for navigation | ✅ |
| File paths in search | `var(--text-body-sm)`, `var(--font-mono)` | Mono for file paths | ✅ |
| Git commit hash | 10px, `var(--font-mono)` | Mono for IDs | ✅ |
| Section headers (Git) | `var(--text-caption)`, `var(--color-text)` | UI font for labels | ✅ |
| Search input | `var(--text-body-sm)`, `var(--font-ui)` | UI font for form fields | ✅ |
| Toolbar icon size | `w-3.5 h-3.5` (14px) | — | ✅ |

Typography is well-compliant. UI/mono font separation is maintained correctly.

#### 11. Responsiveness

The right sidebar:
- Has a resize handle with 220-800px range (`RightSidebar.vue:16-22`)
- Collapses to 0 width when closed (`RightSidebar.vue:88-95`)
- Uses `min-w-0` and `overflow-hidden` for flex shrinking
- No breakpoint-based responsive behavior (not expected for a desktop Electron app)

**Assessment:** Adequate for a desktop Electron app. No mobile/tablet breakpoints needed.

#### 12. Error State Handling

| Component | Error Scenario | Handling | Quality |
|-----------|---------------|----------|---------|
| FileExplorer | File operation failure | Silent `catch` blocks | ❌ No user feedback |
| FileExplorer | Drag-drop failure | Silent `catch` block | ❌ No user feedback |
| SearchPanel | Search API error | `error` ref displayed in `var(--color-error)` | ✅ Text shown |
| SourceControl | Git operation error | `operationError` ref + error banner + auto-dismiss (8s) | ✅ Best in class |
| SourceControl | Git operation in progress | `operationInProgress` disables commit button + "Committing..." text | ✅ Good |
| SourceControl | Branch checkout failure | Handled by store, likely silent | ⚠️ Unknown |

**Gap:** FileExplorer's file operations (rename, create, delete, drag-drop) have silent error handling with no user-facing feedback.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Design language authority | `docs/engineering/design-language.md` | Full file |
| Inline hover style pattern | `RightSidebar.vue` | :61 |
| Inline hover style pattern | `TabBar.vue` | :57-58 |
| Inline hover style pattern (systemic) | `FileExplorer.vue` | :472-473, :484-485, :497-498, :548-549 |
| Inline hover style pattern (systemic) | `SearchPanel.vue` | :106-107, :190-191, :215-216 |
| Inline hover style pattern (systemic) | `SourceControlPanel.vue` | :160-161, :181-182, :193-194, :205-206, :216-217, :228-229, :242-243, :324-325, :338-339, :367-368, :381-382, :421-422, :465-466, :477-478 |
| Hardcoded rgba in drop target | `FileExplorer.vue` | :746-749 |
| Missing ARIA tab roles | `TabBar.vue` | :42-69 (template) |
| No focus-visible rings | All 4 sidebar components | Throughout |
| Context menu material violation | `FileExplorer.vue` | :613-715 |
| Branch dropdown material violation | `SourceControlPanel.vue` | :149-172 |
| Sidebar width config | `sidebar.ts` | :6-8 |
| Motion token hardcoded | `RightSidebar.vue` | :86 |
| Token definitions | `tailwind.css` | :1-102 |
| Git error banner | `SourceControlPanel.vue` | :271-279 |
| Silent file operation errors | `FileExplorer.vue` | :259, :348, :350 |
| Keyboard shortcuts | `useSidebarShortcuts.ts` | :1-55 |
| Panel registry | `useSidebarPanels.ts` | :1-96 |

### Risks / Unknowns

- **[!] High:** Inline hover styles block any future `focus-visible` or `prefers-reduced-motion` implementation. Must be migrated to CSS classes before those features can work.
- **[!] High:** Missing ARIA tab roles means screen readers cannot correctly interpret the tab/panel relationship.
- **[!] Medium:** Context menus and dropdowns use `--surface-solid` instead of `--acrylic` — violates design language material role system.
- **[!] Medium:** No user-facing error feedback for file operations in FileExplorer.
- **[!] Low:** Hardcoded motion values (200ms, 150ms) instead of tokens.
- **[?] Unknown:** Whether the inline hover pattern was a deliberate performance optimization or just quick implementation. The `as HTMLElement` type casts suggest it was a shortcut.
- **[?] Unknown:** Whether screen reader testing has been done at all for the sidebar.

### Priority Recommendations (Not Implementation — Awareness Only)

1. **Migrate inline hover handlers to CSS classes** — single biggest improvement for compliance, accessibility, and maintainability
2. **Add ARIA `role="tablist"/"tab"/"tabpanel"`** — essential for screen reader support
3. **Add `focus-visible` rings** — use existing `--shadow-focus-ring` token
4. **Fix material usage** — context menus and dropdowns should use `--acrylic` not `--surface-solid`
5. **Add error toast/notification** for file operation failures
