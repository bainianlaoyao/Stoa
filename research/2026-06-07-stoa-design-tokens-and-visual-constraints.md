---
date: 2026-06-07
topic: UI design token system and global visual constraints for stoa
status: completed
mode: context-gathering
sources: 7
---

## Context Report: Design Tokens & Global Visual Constraints

### Why This Was Gathered
Settings UI redesign needs an authoritative map of: which CSS variables / design tokens exist, which naming family is canonical, what `design-language.md` and supporting specs forbid, what icon system the project actually uses, and what `data-testid` topology is preserved. Without this, redesign work will either drift into parallel token dialects or violate hard design-language rules.

### Summary
The project binds itself to **standard Fluent 2** as visual authority (canonical tokens in `src/renderer/styles/tailwind.css`). Two naming families coexist today (`--color-*` alias tokens and bare `--surface`/`--text-strong`/etc.), and `frontend-token-unification-spec.md` declares the `--color-*` form the canonical one (no compatibility aliases — breaking migration preferred). There is **no Fluent UI Web Components dependency, no icon library dependency** (Lucide/Heroicons/etc. absent) — icons are either inline SVG paths or imported from `src/renderer/assets/{icons,providers,brand}/*.svg`. Settings UI must reuse the shared `settings-panel` / `settings-card` / `eyebrow` Tailwind utilities and the same token system.

### Key Findings
- **Visual authority = "standard Fluent 2"** (Mica, Acrylic, Smoke, control fills, Fluent motion). Defined in `docs/engineering/design-language.md`. Contract test: `src/renderer/styles.fluent2-contract.test.ts` enforces required token names *and* bans the old glass/glassmorphism/visionOS/blur(40px) vocabulary.
- **Token source of truth = `src/renderer/styles/tailwind.css`**. Defines `--color-*` (theme tokens via `var(--…)`), `--radius-{lg,md,sm}`, `--shadow-{soft,card,flyout,focus-ring,success-ring,active-glow}`, `--font-ui` / `--font-mono`, `--text-{caption,meta,body-sm,body,title-sm,title}`, `--duration-{rest,emphasized}` / `--curve-{standard,decelerate}`. Light + dark themes set concrete values inside `.theme-light` / `.theme-dark`.
- **Fluent 2 materials**: `--mica` (durable app surfaces), `--mica-alt` (subtle separation), `--surface-solid` (dense readable), `--acrylic` (transient overlays/menus/popovers), `--smoke` (modal scrim only).
- **Text roles**: `--text-strong` (headings/values), `--text` (body), `--muted` / `--subtle` (secondary metadata).
- **Controls**: `--control-fill` / `-hover` / `-active`, `--stroke-control` (control border), `--stroke-divider` (layout separator), `--accent` / `--active-fill` (selected, focus, primary action).
- **Motion tokens**: `--duration-rest` (150ms), `--duration-emphasized` (250ms), `--curve-standard`, `--curve-decelerate`. Default `transition: all 0.2s ease` is the project baseline per `frontend-design-consistency-remediation-plan.md` §3.
- **No icon library**: `package.json` has no `lucide` / `heroicons` / `phosphor` / `tabler` / `iconify` / `@mdi` / `fontawesome`. Icons are inline SVG strings (e.g. GlassListbox chevron/check, FileExplorer `FILE_ICON_PATHS`) or imported SVGs from `src/renderer/assets/{icons,providers,brand}/` (provider icons via `composables/provider-icons.ts`).
- **Tailwind v4 utilities used by settings**: `settings-panel`, `settings-card`, `eyebrow`, `btn-primary`, `btn-ghost`, `fluent-bounce`, `fluent-springy` are defined in `tailwind.css` and reused by settings components.
- **Settings components are reference-quality** per remediation plan: `SettingsSurface.vue`, `GeneralSettings.vue`, plus primitives `GlassPathField.vue`, `GlassListbox.vue`, `BaseModal.vue`. `AboutSettings.vue` is the closest "card-heavy" template and uses settings utilities + tokens, but contains some local `rgba(0,0,0,0.x)` literals on `.settings-card:hover` border, the logo gradient container, and link backgrounds — these are the kind of literals the spec asks to be removed or promoted to tokens.
- **`data-testid` topology is preserved during visual-only work** (design-language.md §Implementation Expectations + behavior contract). New settings redesign must keep existing testids (e.g. `settings-panel-about`, `form-field`, `form-input`, `glass-listbox-button`, `modal-root`, etc.) and follow the same BEM-ish class naming (`.settings-card`, `.settings-card__header`, `.settings-card__title`, `.settings-card__badge`, `.settings-card__badge--{accent,success,warning}`).

### Token Catalog (canonical `--color-*` family, from `tailwind.css`)

| Token | Light value | Dark value | Role |
|---|---|---|---|
| `--color-canvas` / `--canvas` | `#f3f3f3` | `#202020` | App background |
| `--color-mica` / `--mica` | `#f3f3f3` | `#202020` | Durable app surface |
| `--color-mica-alt` / `--mica-alt` | `#eeeeee` | `#1c1c1c` | Alternate durable region |
| `--color-acrylic` / `--acrylic` | `rgba(252,252,252,0.78)` | `rgba(44,44,44,0.82)` | Transient overlays / flyouts |
| `--color-smoke` / `--smoke` | `rgba(0,0,0,0.45)` | `rgba(0,0,0,0.45)` | Modal scrim only |
| `--color-surface` | `--mica` | `--mica` | Alias for mica |
| `--color-surface-solid` / `--surface-solid` | `#ffffff` | `#2c2c2c` | Dense content / forms / terminal-adjacent |
| `--color-surface-soft` / `--surface-soft` | `#f9f9f9` | `#252525` | Soft fill |
| `--control-fill` | `rgba(255,255,255,0.70)` | `rgba(255,255,255,0.0605)` | Resting control |
| `--control-fill-hover` | `rgba(249,249,249,0.50)` | `rgba(255,255,255,0.0837)` | Hover |
| `--control-fill-active` | `rgba(249,249,249,0.30)` | `rgba(255,255,255,0.0326)` | Pressed |
| `--color-line` / `--line` | `rgba(0,0,0,0.0578)` | `rgba(255,255,255,0.06)` | Control border |
| `--color-line-strong` / `--line-strong` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.09)` | Layout divider |
| `--stroke-control` | same as `--line` | darker | Control border alias |
| `--stroke-divider` | same as `--line-strong` | stronger | Divider alias |
| `--color-text-strong` / `--text-strong` | `#1a1a1a` | `#ffffff` | Headings/values |
| `--color-text` / `--text` | `#3b3b3b` | `#e1e1e1` | Body |
| `--color-muted` / `--muted` | `#5f5f5f` | `#a0a0a0` | Secondary |
| `--color-subtle` / `--subtle` | `#8a8a8a` | `#707070` | Tertiary |
| `--color-accent` / `--accent` | `#0067c0` | `#60cdff` | Selected / focus / primary action |
| `--color-active-fill` / `--active-fill` | `rgba(0,103,192,0.06)` | `rgba(96,205,255,0.09)` | Selected row tint |
| `--color-success` | `#10b981` | `#10b981` | Success (note: dark variant used `#10b981` too) |
| `--color-warning` | `#f59e0b` | `#fbbf24` | Warning |
| `--color-attention` | `#d97706` | `#fbbf24` | Attention |
| `--color-confirm` | `#7c3aed` | `#a78bfa` | Confirm |
| `--color-error` | `#ef4444` | `#f87171` | Error |
| `--color-overlay-scrim` | `--smoke` | `--smoke` | Scrim alias |
| `--color-black-soft` / `---faint` | `rgba(0,0,0,0.04)` / `0.02` | `rgba(255,255,255,0.06)` / `0.02` | Subtle dark fills |
| `--color-white-strong` / `---soft` / `---faint` | `rgba(255,255,255,0.9)` / `0.56` / `0.42` | `rgba(0,0,0,0.9)` / `0.56` / `0.42` | Subtle light fills |

Non-color tokens: `--radius-lg: 8px`, `--radius-md: 6px`, `--radius-sm: 4px`; `--shadow-soft/card/flyout` (Fluent 2 shadow recipes); `--shadow-focus-ring: 0 0 0 3px rgba(accent,0.25/0.35)`; `--font-ui` (Segoe UI Variable → SF Pro Text → Inter → Microsoft YaHei UI), `--font-mono` (JetBrains Mono → Cascadia Mono → SF Mono → Consolas); type scale 11/12/13/14/15/18px; motion `--duration-rest 150ms`, `--duration-emphasized 250ms`.

### Do / Don't for Settings UI Redesign

**Do**
- Reuse `settings-panel`, `settings-card`, `eyebrow` Tailwind utilities defined in `tailwind.css:317-332` (re-declared in `AboutSettings.vue` as scoped CSS).
- Use `--color-accent` for focus / selected / primary action; `--color-active-fill` for selected row tint.
- Use `--color-surface-solid` for cards, `--color-line-strong` for card borders, `--shadow-card` for card elevation.
- Use `--color-muted` for descriptions, `--color-subtle` for label badges (`settings-card__badge`).
- Apply badge tints via `color-mix(in srgb, var(--color-…) 8%, transparent)` for backgrounds and `12%, transparent` for borders, matching the existing `settings-card__badge--{accent,success,warning}` pattern in `AboutSettings.vue:287-303`.
- Use `--font-ui` for all chrome text, `--font-mono` only for versions / IDs / file paths / timestamps (per design-language.md §5).
- Match motion to either `transition: all 0.2s ease` baseline or the named tokens `--duration-rest` / `--duration-emphasized` with `--curve-standard` / `--curve-decelerate`.
- Use `border: 1px solid var(--stroke-control)` for controls, `var(--stroke-divider)` for structural dividers.
- Use `var(--acrylic)` only for flyouts / popovers / modals (already used by `BaseModal.vue` and `GlassListbox.vue` options with `backdrop-filter: blur(30px) saturate(1.25)`).
- Preserve `data-testid` attributes and follow BEM-ish `.settings-card__*` naming.
- Promote status colors to surface tokens (`--color-success-surface`, etc.) if reusing the same tint in multiple places — spec recommends only when reused.

**Don't**
- Don't hardcode hex / rgba for surfaces, text, borders, shadows, status backgrounds where a token exists (explicit rule in design-language.md §1 and remediation plan §4).
- Don't use `--shadow-glass` / `--shadow-premium` / `--canvas-gradient` / `glassmorphism` / `backdrop-filter: blur(40px)` / `visionOS` — banned by `fluent2-contract.test.ts`.
- Don't introduce a parallel token alias (e.g. keep adding `--surface` style when `--color-surface` exists) — `frontend-token-unification-spec.md` says no compatibility aliases; breaking replacement preferred.
- Don't use shadow tokens as semantic fills / borders (spec rule 2).
- Don't use `--accent` for passive decoration; reserved for selected / focus / primary action.
- Don't use muted/subtle tokens for primary copy.
- Don't use decorative gradients, oversized blur, heavy framing that bypasses tokens (design-language.md §3).
- Don't introduce a new motion timing baseline; deviations require explicit inline justification (remediation plan §3, P3).
- Don't use Mica / Acrylic / Smoke interchangeably: Mica is durable shell, Acrylic is transient overlay, Smoke is modal scrim only.
- Don't mix UI font and mono font without semantic reason.
- Don't change `data-testid` attributes during visual-only work (contract).

### Existing Local-Literal Hot Spots to Clean Up (settings cluster)
- `AboutSettings.vue:239` — `border-color: rgba(0, 85, 255, 0.15)` on `.settings-card:hover`. Should be `color-mix(in srgb, var(--color-accent) 15%, transparent)` or new `--color-accent-soft` token.
- `AboutSettings.vue:277-278` — `background: rgba(0, 0, 0, 0.03); border: 1px solid rgba(0, 0, 0, 0.01);` on `.settings-card__badge`. Should use a `--color-black-soft` style token or a new `--color-badge-surface`.
- `AboutSettings.vue:321-323` — logo container uses a `radial-gradient` with raw rgba and inset box-shadow. Design language explicitly bans "decorative gradients"; redesign should use `--color-surface-solid` + ring token.
- `AboutSettings.vue:443, 454` — `.settings-about__link` background `rgba(0,0,0,0.008)` and hover `rgba(0,0,0,0.03)`. Replace with `--color-black-faint` / `--color-black-soft` (already exist).
- `AboutSettings.vue:235, 449, 463` — hardcoded `transition: all 0.2s ease`. Should be `var(--duration-rest) var(--curve-standard)`.
- `AboutSettings.vue:194` — typo `border-b: 1px solid var(--color-line)` (no such property) — leaves the header with no border. Use `border-bottom`.

### Evidence Chain
| Finding | Source | Location |
|---|---|---|
| Visual authority = standard Fluent 2 | `docs/engineering/design-language.md` | `design-language.md:9-13` |
| Non-negotiable rules + material / text / control / motion systems | `docs/engineering/design-language.md` | `design-language.md:17-107` |
| Token system source of truth | `src/renderer/styles/tailwind.css` | `tailwind.css:1-227` |
| Canonical `--color-*` aliases + radius/shadow/font/type/motion tokens | `src/renderer/styles/tailwind.css` | `tailwind.css:3-102` |
| Light + dark Fluent 2 token values | `src/renderer/styles/tailwind.css` | `tailwind.css:132-227` |
| Shared utilities: `btn-primary`, `btn-ghost`, `eyebrow`, `settings-panel`, `settings-card`, `fluent-bounce`, `fluent-springy` | `src/renderer/styles/tailwind.css` | `tailwind.css:247-349` |
| Contract test pins token presence + bans old glass vocabulary | `src/renderer/styles.fluent2-contract.test.ts` | `fluent2-contract.test.ts:9-62` |
| Token unification spec — `--color-*` is canonical, no aliases | `docs/engineering/frontend-token-unification-spec.md` | `frontend-token-unification-spec.md:1-192` |
| Remediation plan — token, glass, motion, hardcoding themes + priority | `docs/engineering/frontend-design-consistency-remediation-plan.md` | `frontend-design-consistency-remediation-plan.md:1-219` |
| Settings reference-quality components | `docs/engineering/frontend-design-consistency-remediation-plan.md` | `frontend-design-consistency-remediation-plan.md:175-192` |
| Settings card pattern + badge variants (template) | `src/renderer/components/settings/AboutSettings.vue` | `AboutSettings.vue:227-303` |
| Local rgba literals to clean up | `src/renderer/components/settings/AboutSettings.vue` | `AboutSettings.vue:194, 235, 239, 277-278, 321-323, 443, 449, 454, 463` |
| `data-testid` topology preserved during visual work | `docs/engineering/design-language.md` | `design-language.md:140-143` |
| Acrylic used only for transient overlays; modal pattern | `src/renderer/components/primitives/BaseModal.vue` | `BaseModal.vue:55-67` |
| Form field primitive (reference quality) | `src/renderer/components/primitives/GlassFormField.vue` | `GlassFormField.vue:18-34` |
| Listbox / flyout pattern with `--acrylic` + `blur(30px) saturate(1.25)` | `src/renderer/components/primitives/GlassListbox.vue` | `GlassListbox.vue:138-153` |
| Provider / brand icons are imported SVGs (no library) | `src/renderer/composables/provider-icons.ts` | `provider-icons.ts:1-38` |
| Settings utility tokens already exposed as Tailwind theme names | `src/renderer/styles/tailwind.css` | `tailwind.css:5-44` |
| No `lucide` / `heroicons` / `phosphor` / `tabler` / `iconify` / `fontawesome` / `@mdi` in deps | `package.json` (grep) | (no matches) |

### Risks / Unknowns
- [!] **Two parallel token families coexist** in the renderer today (`--color-*` and bare `--surface` / `--text-strong` / `--line` / etc.). New settings UI MUST use the canonical `--color-*` form. Mixing the two will fail code review per `frontend-token-unification-spec.md` §Enforcement.
- [!] **Settings card hover uses raw rgba** (`rgba(0, 85, 255, 0.15)`) — a real bug under the design language. Any settings redesign should fix the hot spots listed above; otherwise the new layout ships with the same drift.
- [!] **No semantic surface tokens yet** (`--color-success-surface` etc. are recommended additions, not present). If redesign reuses a status tint, promote it to a token — do not duplicate the rgba.
- [!] **`backdrop-filter: blur(30px) saturate(1.25)`** is the project's chosen Acrylic recipe (used in `BaseModal` and `GlassListbox`); do not exceed this — the contract test explicitly bans `blur(40px)`.
- [!] **`data-testid` topology must be preserved** during visual-only work. Any `data-testid` change is a behavior contract break, not just a UI change.
- [?] Whether a settings-specific dialog should live in `BaseModal.vue` (already Acrylic + smoke + flyout shadow) or get a custom shell — `BaseModal.vue` already matches the spec exactly, default to it.
- [?] Whether the redesign will introduce a `data-testid` for a new settings sub-section — confirm with the requester; this is a topology-affecting change.
- [?] The `AboutSettings.vue:194` `border-b` typo: this file is in the working tree (status: M); whether the user intends to also fix it as part of redesign or keep the current diff is unclear. Don't paper over it silently.
- [?] Whether `--color-attention` light value `#d97706` vs dark `#fbbf24` (warning-like) is intentional; dark variant looks like a warning. If status semantics matter for the redesign, raise this.
- [?] Whether the `--font-ui` fallback `Microsoft YaHei UI` (Chinese) should remain the renderer default — relevant only if settings UI is to be localized in zh-CN, which `src/renderer/i18n/zh-CN.ts` already supports.
