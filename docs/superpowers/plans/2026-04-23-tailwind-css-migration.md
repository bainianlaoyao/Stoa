# Tailwind CSS v4 Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1261-line monolithic `styles.css` with Tailwind CSS v4, moving all component-specific styles into `<style scoped>` or inline Tailwind classes within each `.vue` file.

**Architecture:** Two-phase migration. Phase 1 sets up Tailwind v4 and migrates design tokens + global resets — zero visual change. Phase 2 converts each component's BEM classes to Tailwind utilities or scoped styles, one component at a time, verifying visual parity after each.

**Tech Stack:** Tailwind CSS v4, @tailwindcss/vite, Vue 3 `<style scoped>`, electron-vite

---

## Phase 1: Foundation (Tailwind Setup + Token Migration)

Goal: Install Tailwind v4, port all design tokens into `@theme`, keep visual output identical.

### Task 1.1: Install Tailwind CSS v4

**Files:**
- Modify: `package.json` (dependency added)
- Modify: `electron.vite.config.ts` (plugin added)
- Create: `src/renderer/styles/tailwind.css` (entry point)
- Modify: `src/renderer/main.ts` (import change)

- [ ] **Step 1: Install packages**

```bash
pnpm add -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Add Tailwind Vite plugin to renderer config**

In `electron.vite.config.ts`, add the import and plugin to the `renderer` section:

```ts
import tailwindcss from '@tailwindcss/vite'

// inside renderer config:
plugins: [vue(), tailwindcss()]
```

- [ ] **Step 3: Create Tailwind entry CSS**

Create `src/renderer/styles/tailwind.css`:

```css
@import 'tailwindcss';
```

- [ ] **Step 4: Update main.ts import**

In `src/renderer/main.ts`, change:

```ts
import '@renderer/styles.css'
```

to:

```ts
import '@renderer/styles/tailwind.css'
```

- [ ] **Step 5: Verify dev server starts**

```bash
pnpm dev
```

Expected: App loads, but styles are broken (no tokens loaded yet). Dev server starts without errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: install tailwind css v4 and add vite plugin"
```

---

### Task 1.2: Port design tokens to @theme

**Files:**
- Modify: `src/renderer/styles/tailwind.css` (add @theme + global resets)
- Delete: `src/renderer/styles.css` (after migration complete — deferred to Phase 2 end)

- [ ] **Step 1: Add @theme with all existing tokens**

Replace `src/renderer/styles/tailwind.css` content with the full token migration. This maps every `:root` CSS variable into Tailwind's `@theme` so they become available as `var(--*)` utility classes and Tailwind can reference them:

```css
@import 'tailwindcss';

@theme {
  /* Color tokens */
  --color-canvas: #f4f5f8;
  --color-surface: rgba(255, 255, 255, 0.75);
  --color-surface-solid: #ffffff;
  --color-surface-soft: rgba(255, 255, 255, 0.42);
  --color-line: rgba(0, 0, 0, 0.06);
  --color-line-strong: rgba(0, 0, 0, 0.1);
  --color-text-strong: #111418;
  --color-text: #373c44;
  --color-muted: #808792;
  --color-subtle: #a6acb5;
  --color-accent: #0055ff;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-attention: #d97706;
  --color-confirm: #7c3aed;
  --color-error: #ef4444;
  --color-terminal-bg: #0a0b0d;
  --color-terminal-text: #e2e8f0;
  --color-terminal-border: rgba(255, 255, 255, 0.06);
  --color-black-soft: rgba(0, 0, 0, 0.04);
  --color-black-faint: rgba(0, 0, 0, 0.02);
  --color-white-strong: rgba(255, 255, 255, 0.9);
  --color-white-soft: rgba(255, 255, 255, 0.56);
  --color-white-faint: rgba(255, 255, 255, 0.42);

  /* Radius tokens */
  --radius-lg: 18px;
  --radius-md: 12px;
  --radius-sm: 8px;

  /* Shadow tokens */
  --shadow-soft: 0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02);
  --shadow-card: 0 2px 6px rgba(0, 0, 0, 0.02), 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow-premium: 0 24px 48px -12px rgba(0, 0, 0, 0.08), 0 8px 16px -4px rgba(0, 0, 0, 0.03), 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow-success-ring: 0 0 0 2px rgba(16, 185, 129, 0.16);

  /* Font tokens */
  --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;

  /* Font size tokens */
  --text-caption: 11px;
  --text-meta: 12px;
  --text-body-sm: 13px;
  --text-body: 14px;
  --text-title-sm: 15px;
  --text-title: 18px;

  /* Spacing tokens */
  --terminal-shell-gap: clamp(10px, 1.4vw, 18px);
}
```

- [ ] **Step 2: Add global resets and @font-face below the @theme block**

Append after `@theme` in the same file:

```css
/* ── Font faces ── */

@font-face {
  font-family: 'JetBrains Mono';
  src: url('./assets/fonts/JetBrainsMono[wght].woff2') format('woff2-variations');
  font-weight: 100 800;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Cascadia Mono';
  src: url('./assets/fonts/CascadiaMono.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

/* ── Base layer ── */

@layer base {
  :root {
    color-scheme: light;
    font-family: var(--font-ui);
    font-size: var(--text-body);
    background: var(--color-canvas);
    color: var(--color-text);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    min-height: 100vh;
    line-height: 1.5;
    background:
      radial-gradient(at 0% 0%, #ffffff 0%, transparent 45%),
      radial-gradient(at 100% 0%, #e8edf7 0%, transparent 48%),
      radial-gradient(at 100% 100%, #ffffff 0%, transparent 45%),
      var(--color-canvas);
  }

  button { font: inherit; }
  code { font-family: var(--font-mono); }
  #app { min-height: 100vh; }
}
```

Note: `@font-face` url paths reference `./assets/fonts/` relative to the new `styles/tailwind.css` location — this resolves to `src/renderer/assets/fonts/`, same as before.

- [ ] **Step 3: Keep old styles.css temporarily co-imported**

In `src/renderer/main.ts`, import BOTH files during transition:

```ts
import '@renderer/styles/tailwind.css'
import '@renderer/styles.css'
```

This ensures nothing breaks while we migrate components in Phase 2.

- [ ] **Step 4: Verify dev server starts and visual parity holds**

```bash
pnpm dev
```

Expected: App looks identical. Both stylesheets loaded, no conflicts.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: port design tokens to tailwind @theme with global resets"
```

---

## Phase 2: Component-by-Component Migration

Goal: Convert each component's BEM classes to Tailwind utilities, one at a time, removing styles from `styles.css` as we go. Delete `styles.css` at the end.

**Migration order principle:** Start from leaf/primitive components (fewest dependencies), work up to surfaces and layout. Each task removes its classes from `styles.css` and converts them in the component.

---

### Task 2.1: Migrate BaseModal + GlassFormField (primitives)

These are leaf components reused by others. Migrating them first unblocks all modal/form consumers.

**Files:**
- Modify: `src/renderer/components/primitives/BaseModal.vue`
- Modify: `src/renderer/components/primitives/GlassFormField.vue`
- Modify: `src/renderer/styles.css` (remove migrated classes)

**BaseModal.vue classes to migrate:** `.modal-overlay`, `.modal-panel`, `.modal-panel__header`, `.modal-panel__title`, `.modal-panel__close`, `.modal-panel__body`, `.modal-panel__footer`, `.modal-panel__error`, `.modal-enter-active`, `.modal-leave-active`, `.modal-enter-from`, `.modal-leave-to`

**GlassFormField.vue classes to migrate:** `.form-field`, `.form-field__label`, `.form-field__input`, `.form-field__select`, and `:focus`/`::placeholder` states

- [ ] **Step 1: Convert BaseModal.vue template to Tailwind classes**

Replace BEM class names with Tailwind utility classes directly in the template. Map:

| BEM Class | Tailwind Equivalent |
|---|---|
| `.modal-overlay` | `fixed inset-0 bg-black/45 z-50 flex items-center justify-center` |
| `.modal-panel` | `bg-surface-solid border border-line rounded-[18px] shadow-premium max-w-[360px] w-full p-5` |
| `.modal-panel__header` | `flex items-center justify-between mb-4` |
| `.modal-panel__title` | `text-[15px] font-semibold text-text-strong` |
| `.modal-panel__close` | `bg-transparent text-muted w-6 h-6 rounded-lg border-none cursor-pointer flex items-center justify-center text-base leading-none hover:bg-black-soft hover:text-text-strong` |
| `.modal-panel__body` | `grid gap-4` |
| `.modal-panel__footer` | `flex justify-end gap-2 mt-5` |
| `.modal-panel__error` | `text-xs text-error bg-error/8 rounded-md px-3 py-2 mt-2` |

- [ ] **Step 2: Move Transition classes to `<style scoped>`**

In BaseModal.vue, add a scoped style block for the transition:

```vue
<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
```

Keep `name="modal"` on the `<Transition>` component — Vue scoped handles these classes automatically.

- [ ] **Step 3: Convert GlassFormField.vue template to Tailwind classes**

Map:

| BEM Class | Tailwind Equivalent |
|---|---|
| `.form-field` | `grid gap-1.5` |
| `.form-field__label` | `text-[11px] font-semibold text-muted uppercase tracking-wider` |
| `.form-field__input` | `bg-surface-solid border border-line rounded-lg px-2.5 py-2 font-inherit text-text-strong outline-none w-full focus:border-accent focus:ring-2 focus:ring-accent/12 placeholder:text-subtle` |
| `.form-field__select` | `bg-surface-solid border border-line rounded-lg px-2.5 py-2 font-inherit text-text-strong outline-none w-full appearance-none focus:border-accent focus:ring-2 focus:ring-accent/12` |

- [ ] **Step 4: Remove migrated classes from styles.css**

Delete these class blocks from `styles.css`:
- `.modal-overlay` through `.modal-panel__error` (lines ~562-633)
- `.form-field` through `.form-field__select:focus` (lines ~636-683)
- `.modal-enter-active` through `.modal-leave-to` (lines ~719-727)

- [ ] **Step 5: Verify modal opens and form fields render correctly**

```bash
pnpm dev
```

Open the app, trigger a modal (e.g., new project), verify:
- Overlay appears with correct backdrop
- Panel has correct border-radius, shadow, padding
- Close button works
- Input fields focus with accent ring
- Select dropdowns look correct

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "migrate: BaseModal and GlassFormField to tailwind utilities"
```

---

### Task 2.2: Migrate button utilities + NewProjectModal

**Files:**
- Modify: `src/renderer/components/command/NewProjectModal.vue`
- Modify: `src/renderer/styles.css` (remove button classes + form field leftovers)

**Button classes to migrate:** `.button-primary`, `.button-ghost` (shared utilities used across components)

**NewProjectModal uses:** form-field classes (now tailwind), button classes, `.modal-panel__footer`, `.modal-panel__error`

- [ ] **Step 1: Create a shared Tailwind @utility for buttons**

In `src/renderer/styles/tailwind.css`, add after the `@layer base` block:

```css
/* ── Shared utilities ── */

@utility btn-primary {
  background: var(--color-text-strong);
  color: var(--color-surface-solid);
  border: none;
  border-radius: var(--radius-sm);
  padding: 7px 14px;
  font-size: var(--text-body-sm);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    opacity: 0.85;
  }
}

@utility btn-ghost {
  background: transparent;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  padding: 7px 14px;
  font-size: var(--text-body-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--color-black-soft);
    color: var(--color-text-strong);
  }
}
```

- [ ] **Step 2: Convert NewProjectModal.vue template**

Replace all BEM classes with Tailwind utilities and `btn-primary`/`btn-ghost` custom utilities. This component is a modal form, so it uses the BaseModal wrapper — only the inner content classes need conversion.

- [ ] **Step 3: Remove `.button-primary` and `.button-ghost` from styles.css**

Delete lines ~686-717.

- [ ] **Step 4: Update any other components using these button classes**

Search for `button-primary` and `button-ghost` across all `.vue` files and replace with `btn-primary` / `btn-ghost`.

- [ ] **Step 5: Verify**

```bash
pnpm dev
```

Trigger new project modal. Verify button styles, form layout.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "migrate: button utilities and NewProjectModal to tailwind"
```

---

### Task 2.3: Migrate GlobalActivityBar

**Files:**
- Modify: `src/renderer/components/GlobalActivityBar.vue`
- Modify: `src/renderer/styles.css` (remove activity-bar section)

**Classes to migrate:** `.activity-bar`, `.activity-bar__brand`, `.activity-bar__cluster`, `.activity-bar__cluster--bottom`, `.activity-bar__item`, `.activity-bar__item--active`, `.activity-bar__dot`

- [ ] **Step 1: Convert GlobalActivityBar.vue template to Tailwind**

Map:

| BEM Class | Tailwind Equivalent |
|---|---|
| `.activity-bar` | `grid grid-rows-[auto_auto_1fr_auto] py-5 px-0 bg-transparent` |
| `.activity-bar__brand` | `w-6 h-6 mx-auto mb-6 grid place-items-center rounded-lg bg-text-strong text-surface-solid text-xs font-bold tracking-wide shadow-soft` |
| `.activity-bar__cluster` | `grid gap-3` |
| `.activity-bar__cluster--bottom` | `self-end` |
| `.activity-bar__item` | `relative w-9 h-9 mx-auto border-0 rounded-[10px] bg-transparent text-muted cursor-pointer transition-all duration-200 ease-in-out hover:text-text-strong hover:bg-black-soft focus-visible:text-text-strong focus-visible:bg-black-soft focus-visible:outline-none` |
| `.activity-bar__item--active` | `text-text-strong bg-surface-solid shadow-soft` |
| `.activity-bar__dot` | `absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-error shadow-[0_0_0_2px_var(--color-canvas)]` |

Use `:class` binding for active state:
```html
:class="isActive ? 'text-text-strong bg-surface-solid shadow-soft' : ''"
```

- [ ] **Step 2: Remove activity-bar classes from styles.css**

Delete lines ~113-178.

- [ ] **Step 3: Verify sidebar renders correctly**

```bash
pnpm dev
```

Check: activity bar icons, active state highlight, dot indicator.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "migrate: GlobalActivityBar to tailwind utilities"
```

---

### Task 2.4: Migrate AppShell layout

**Files:**
- Modify: `src/renderer/components/AppShell.vue`
- Modify: `src/renderer/styles.css` (remove app-shell + global h2/eyebrow)

**Classes to migrate:** `.app-shell`, `.app-shell__viewport`, `.eyebrow`, `h2`

- [ ] **Step 1: Convert AppShell.vue template**

Map:

| BEM Class | Tailwind Equivalent |
|---|---|
| `.app-shell` | `grid grid-cols-[56px_1fr] min-h-screen p-0 gap-0` |
| `.app-shell__viewport` | `min-w-0 min-h-0 m-3 ml-0 border border-black/[0.04] rounded-2xl bg-surface backdrop-blur-[40px] saturate-[1.2] shadow-premium overflow-hidden` |

Note: `inset 0 1px 0 rgba(255, 255, 255, 0.9)` inner shadow can be added as `<style scoped>` or via Tailwind arbitrary value.

- [ ] **Step 2: Move `.eyebrow` to scoped styles in components that use it**

`.eyebrow` is used in 8+ components. Convert to a shared Tailwind utility:

In `src/renderer/styles/tailwind.css`, add:

```css
@utility eyebrow {
  margin: 0 0 8px;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--text-caption);
  font-weight: 600;
}
```

Then replace all `class="eyebrow"` with `class="eyebrow"` — the @utility makes it work as a Tailwind class.

- [ ] **Step 3: Remove migrated classes from styles.css**

Delete: `.app-shell` through `.app-shell__viewport` (lines ~92-111), `.eyebrow` (lines ~181-188), `h2` (lines ~190-193).

- [ ] **Step 4: Verify layout**

```bash
pnpm dev
```

Check: two-column layout, viewport border-radius and glass effect, eyebrow text in settings/archive.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "migrate: AppShell layout and eyebrow utility to tailwind"
```

---

### Task 2.5: Migrate CommandSurface + WorkspaceHierarchyPanel

This is the largest migration block — the command panel and route/session list.

**Files:**
- Modify: `src/renderer/components/command/CommandSurface.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify: `src/renderer/components/command/HierarchyNode.vue`
- Modify: `src/renderer/styles.css` (remove command-panel, route-*, hierarchy-* classes)

**Classes to migrate (CommandSurface):** `.command-panel`, `.command-body`, `.command-layout`

**Classes to migrate (WorkspaceHierarchyPanel):** `.workspace-hierarchy-panel`, `.route-body`, `.route-actions`, `.route-action`, `.route-action-label`, `.route-action-icon`, `.route-group`, `.group-label`, `.route-project`, `.route-project-row`, `.route-item`, `.route-item--active`, `.route-item--parent`, `.route-item.child`, `.route-dot`, `.route-dot.*` (status variants), `.route-copy`, `.route-name`, `.route-path`, `.route-time`, `.route-add-session`, `.route-project-actions`, `.hierarchy-node__copy`, `.hierarchy-node__meta`, `.hierarchy-node__status[data-status='needs_confirmation']`, `.tree-row`

- [ ] **Step 1: Convert CommandSurface.vue template**

Map:

| BEM Class | Tailwind Equivalent |
|---|---|
| `.command-panel` | `h-full min-h-0` |
| `.command-body` | `h-full p-2.5 min-h-0 grid` |
| `.command-layout` | `h-full grid grid-cols-[240px_minmax(0,1fr)] gap-2.5 min-h-0 items-stretch` |

- [ ] **Step 2: Convert WorkspaceHierarchyPanel.vue template**

This component has the most BEM classes. Convert each to Tailwind utilities inline. For complex hover/active states that need nested selectors or attribute selectors (e.g., `.route-dot.running`), use `<style scoped>`:

```vue
<style scoped>
/* Status dot variants */
.dot-idle, .dot-starting, .dot-bootstrapping { background: #cbd5e1; }
.dot-running { background: var(--color-success); box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15); }
.dot-awaiting_input, .dot-awaiting, .dot-degraded { background: var(--color-warning); }
.dot-error, .dot-exited { background: var(--color-error); }

/* Confirmation status */
.status-confirmation { background: var(--color-confirm); }
</style>
```

Use dynamic `:class` bindings to map session status to dot classes.

- [ ] **Step 3: Convert HierarchyNode.vue**

Minimal component — convert `.hierarchy-node` to simple Tailwind classes.

- [ ] **Step 4: Remove all migrated classes from styles.css**

Delete lines ~195-465 (command-panel, command-body, command-layout, workspace-hierarchy-panel, route-*, hierarchy-node-*, tree-row).

- [ ] **Step 5: Verify command surface**

```bash
pnpm dev
```

Check: session list renders, route dots show correct status colors, active item highlight, hover states, scroll behavior.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "migrate: CommandSurface and WorkspaceHierarchyPanel to tailwind"
```

---

### Task 2.6: Migrate Terminal components

**Files:**
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/command/TerminalMetaBar.vue`
- Modify: `src/renderer/styles.css` (remove terminal-* classes)

**Classes to migrate:** `.terminal-screen`, `.terminal-empty-state`, `.terminal-meta`, `.terminal-meta__group`, `.terminal-meta__group--secondary`, `.terminal-stream`, `.terminal-stream__viewport`, `.terminal-surface__mount`, `.terminal-surface__mount-stack`, `.terminal-surface__mount--active`

Note: TerminalViewport.vue already has extensive `<style scoped>` — migrate only the global classes from `styles.css`.

- [ ] **Step 1: Convert TerminalMetaBar.vue template**

Map:

| BEM Class | Tailwind Equivalent |
|---|---|
| `.terminal-meta` | `flex justify-between gap-2 text-slate-500 font-mono text-[11px]` |
| `.terminal-meta__group` | `inline-flex gap-2 items-center min-w-0` |
| `.terminal-meta__group--secondary` | `justify-end` |

- [ ] **Step 2: Migrate remaining terminal global classes to TerminalViewport.vue scoped styles**

Move `.terminal-screen`, `.terminal-empty-state`, `.terminal-stream`, `.terminal-stream__viewport`, `.terminal-surface__mount*` into the existing `<style scoped>` block of TerminalViewport.vue.

- [ ] **Step 3: Remove terminal classes from styles.css**

Delete lines ~459-527.

- [ ] **Step 4: Verify terminal rendering**

```bash
pnpm dev
```

Check: terminal screen dark background, meta bar layout, scroll behavior, xterm mount visibility toggling.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "migrate: Terminal components to tailwind/scoped styles"
```

---

### Task 2.7: Migrate Settings surface (full section)

This is the second-largest block (~400 lines). Settings components share many layout patterns.

**Files:**
- Modify: `src/renderer/components/settings/SettingsSurface.vue`
- Modify: `src/renderer/components/settings/SettingsTabBar.vue`
- Modify: `src/renderer/components/settings/GeneralSettings.vue`
- Modify: `src/renderer/components/settings/ProvidersSettings.vue`
- Modify: `src/renderer/components/settings/AboutSettings.vue`
- Modify: `src/renderer/styles.css` (remove all settings-* classes)

**Shared patterns to extract as @utility:**
- `.settings-card` — used in all settings panels
- `.settings-panel` — used in General, Providers, About

- [ ] **Step 1: Add shared settings utilities to tailwind.css**

```css
@utility settings-panel {
  display: grid;
  gap: 18px;
  min-height: 100%;
  padding: 22px;
  align-content: start;
}

@utility settings-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border-radius: var(--radius-md);
  background: var(--color-surface-solid);
  border: 1px solid var(--color-line);
}
```

- [ ] **Step 2: Convert SettingsSurface.vue template**

Migrate all `.settings-surface__*` classes to Tailwind utilities. The responsive breakpoint:

```css
/* In <style scoped> */
@media (max-width: 980px) {
  .hero-grid, .shell-grid, .section-about, .settings-field {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Convert SettingsTabBar.vue template**

All `.settings-tab-bar__*` classes to Tailwind.

- [ ] **Step 4: Convert GeneralSettings.vue, ProvidersSettings.vue, AboutSettings.vue**

Each follows the same pattern: `.settings-panel` → `settings-panel` utility, `.settings-card` → `settings-card` utility, inner elements to Tailwind utilities.

- [ ] **Step 5: Remove all settings classes from styles.css**

Delete lines ~765-1171.

- [ ] **Step 6: Verify all settings tabs**

```bash
pnpm dev
```

Navigate to each settings tab. Verify layout, responsive behavior at 980px breakpoint, card styles, form fields, badges.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "migrate: Settings surface components to tailwind"
```

---

### Task 2.8: Migrate Provider components

**Files:**
- Modify: `src/renderer/components/command/ProviderFloatingCard.vue`
- Modify: `src/renderer/components/command/ProviderRadialMenu.vue`
- Modify: `src/renderer/styles.css` (remove provider-* and radial-menu-* classes)

- [ ] **Step 1: Convert ProviderFloatingCard.vue**

Map:

| BEM Class | Tailwind Equivalent |
|---|---|
| `.provider-floating-card` | `fixed z-[100] bg-surface-solid border border-line rounded-xl shadow-card p-1.5 flex gap-1` |
| `.provider-icon-cell` | `grid place-items-center gap-0.5 w-[52px] h-[52px] border-0 rounded-lg bg-transparent cursor-pointer transition-all duration-200 hover:bg-black-soft active:bg-black/6` |
| `.provider-icon-cell__image` | `w-[33px] h-[33px] block object-contain` |

- [ ] **Step 2: Convert ProviderRadialMenu.vue**

Migrate `.radial-menu`, `.radial-menu__track`, `.radial-menu__item`, `.radial-menu__item-image`. This component already has `<style scoped>` — merge global classes into the scoped block.

- [ ] **Step 3: Remove migrated classes from styles.css**

Delete lines ~729-763 (provider floating card) and ~1180-1228 (radial menu).

- [ ] **Step 4: Verify provider interactions**

```bash
pnpm dev
```

Check: floating card appears on hover, radial menu positioning, icon sizing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "migrate: Provider components to tailwind"
```

---

### Task 2.9: Migrate placeholder surfaces + remaining misc

**Files:**
- Modify: `src/renderer/components/inbox/InboxQueueSurface.vue`
- Modify: `src/renderer/components/tree/ContextTreeSurface.vue`
- Modify: `src/renderer/styles.css` (remove placeholder-*, route-add-session duplicate, media queries)

**Classes to migrate:** `.placeholder-surface`, `.placeholder-surface__lane`, `.placeholder-surface__lane--full`, `.placeholder-card`, `.placeholder-button`, `.placeholder-surface__lane p`, `.terminal-surface__footer p`, `.terminal-empty-state p`, `.terminal-meta-bar__items`

- [ ] **Step 1: Convert InboxQueueSurface.vue and ContextTreeSurface.vue**

Map:

| BEM Class | Tailwind Equivalent |
|---|---|
| `.placeholder-surface` | `grid grid-cols-[minmax(0,0.92fr)_minmax(260px,0.78fr)] gap-2.5 p-2.5` |
| `.placeholder-surface__lane` | `grid align-content-start gap-3` |
| `.placeholder-card` | `flex justify-between gap-3 p-3 border border-line rounded-lg bg-surface-solid` |
| `.placeholder-button` | `flex items-center justify-between gap-2 px-2.5 py-2 border border-black/[0.03] rounded-lg bg-surface-solid text-text-strong shadow-[0_1px_3px_rgba(0,0,0,0.02)] cursor-pointer transition-colors duration-200` |

- [ ] **Step 2: Handle remaining responsive media query**

The last `@media (max-width: 960px)` block for command-layout and placeholder-surface goes into the relevant components' `<style scoped>`.

- [ ] **Step 3: Remove all remaining classes from styles.css**

Delete everything that's left. The file should now be empty or contain only the duplicated `.route-add-session` block (lines ~1230-1254) — remove that too.

- [ ] **Step 4: Remove styles.css import from main.ts**

In `src/renderer/main.ts`, remove:

```ts
import '@renderer/styles.css'
```

Only `import '@renderer/styles/tailwind.css'` remains.

- [ ] **Step 5: Delete styles.css**

```bash
rm src/renderer/styles.css
```

- [ ] **Step 6: Full visual regression check**

```bash
pnpm dev
```

Test every surface:
- [ ] Activity bar — icons, active state, dot indicator
- [ ] Command surface — session list, route dots, hierarchy
- [ ] Terminal — dark theme, meta bar, xterm
- [ ] Settings — all tabs, responsive at 980px
- [ ] Modal — open/close, form fields
- [ ] Provider floating card + radial menu
- [ ] Inbox + context tree placeholder surfaces

- [ ] **Step 7: Run test suite**

```bash
pnpm test
```

Expected: All existing tests pass. Update any tests that assert CSS class names (e.g., `styles.typography.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "migrate: remaining components to tailwind, delete styles.css"
```

---

### Task 2.10: Cleanup + verification

**Files:**
- Modify: `src/renderer/styles/tailwind.css` (final cleanup)
- Modify: `src/renderer/styles.typography.test.ts` (update if needed)
- Delete: `src/renderer/styles.css` (if not already deleted)

- [ ] **Step 1: Audit tailwind.css for unused utilities**

Review `src/renderer/styles/tailwind.css` and remove any `@utility` definitions that aren't actually used.

- [ ] **Step 2: Update typography test**

The test at `src/renderer/styles.typography.test.ts` reads `styles.css` — update it to read `styles/tailwind.css` and adjust assertions to match the new `@theme` syntax.

- [ ] **Step 3: Build verification**

```bash
pnpm build
```

Expected: Clean build with no errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: cleanup after tailwind migration, update tests"
```

---

## Summary

**Phase 1** (2 tasks): Zero visual change, foundational setup
- Task 1.1: Install Tailwind + Vite plugin
- Task 1.2: Port tokens to @theme + global resets

**Phase 2** (8 tasks): Component-by-component migration
- Task 2.1: BaseModal + GlassFormField (primitives first)
- Task 2.2: Buttons + NewProjectModal
- Task 2.3: GlobalActivityBar
- Task 2.4: AppShell layout + eyebrow utility
- Task 2.5: CommandSurface + WorkspaceHierarchyPanel (largest block)
- Task 2.6: Terminal components
- Task 2.7: Settings surface (second largest)
- Task 2.8: Provider components
- Task 2.9: Placeholder surfaces + delete styles.css
- Task 2.10: Cleanup + final verification

**Total: 10 tasks, ~20 commits, each task independently verifiable.**
