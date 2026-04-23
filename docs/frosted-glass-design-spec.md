# Frosted Glass Design Specification

> Elegant, bright frosted-glass visual language for ultra-simple-panel

## 1. Design Philosophy

**Light, layered, legible.** A frosted glass surface should feel like looking through a rain-misted window — soft, luminous, with content underneath gently diffused but never obscured. Every glass layer adds depth without distraction.

Three principles:

1. **Content first** — blur and transparency serve readability, not decoration
2. **Consistent layering** — each surface level has a fixed elevation, blur, and opacity
3. **Minimal moving parts** — pure CSS only; no SVG filters, no JS-driven effects

---

## 2. Elevation System

Three glass layers. Each maps to a semantic role in the UI.

| Layer | Token | Background | Blur | Border | Shadow | Role |
|-------|-------|-----------|------|--------|--------|------|
| **Glass 1** | `--glass-1` | `rgba(255,255,255,0.72)` | `blur(32px) saturate(140%)` | `rgba(0,0,0,0.04)` | `--shadow-glass-1` | Primary surface — main panels, nav panels |
| **Glass 2** | `--glass-2` | `rgba(255,255,255,0.55)` | `blur(24px) saturate(130%)` | `rgba(0,0,0,0.06)` | `--shadow-glass-2` | Floating / secondary — cards, popovers |
| **Glass 3** | `--glass-3` | `rgba(255,255,255,0.40)` | `blur(16px) saturate(120%)` | `rgba(255,255,255,0.35)` | `--shadow-glass-3` | Transient / decorative — radial track, overlays |

### Shadow definitions

```css
--shadow-glass-1:
  0 24px 48px -12px rgba(0, 0, 0, 0.06),
  0 8px 16px -4px rgba(0, 0, 0, 0.02),
  inset 0 1px 0 rgba(255, 255, 255, 0.85);

--shadow-glass-2:
  0 8px 24px -4px rgba(0, 0, 0, 0.04),
  0 2px 6px rgba(0, 0, 0, 0.02),
  inset 0 1px 0 rgba(255, 255, 255, 0.7);

--shadow-glass-3:
  0 4px 12px rgba(0, 0, 0, 0.03),
  inset 0 1px 0 rgba(255, 255, 255, 0.5);
```

Key detail: every glass shadow includes an `inset 0 1px 0` white highlight at the top edge — this is the single most important visual cue that makes a surface read as "glass" rather than just "translucent".

### Compositing recipe (per layer)

```css
/* Glass 1 — example */
.surface-glass-1 {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.78) 0%,
    rgba(255, 255, 255, 0.68) 100%
  );
  backdrop-filter: blur(32px) saturate(140%);
  -webkit-backdrop-filter: blur(32px) saturate(140%);
  border: 1px solid rgba(0, 0, 0, 0.04);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-glass-1);
}
```

The `linear-gradient` on background adds a subtle top-to-bottom luminance shift, making the glass feel directional (light from above). This replaces flat `rgba` backgrounds.

---

## 3. Interaction States

### Hover — gentle brightening

```css
.surface-glass:hover {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.88) 0%,
    rgba(255, 255, 255, 0.72) 100%
  );
  border-color: rgba(0, 0, 0, 0.06);
  transition: background 0.25s ease, border-color 0.25s ease;
}
```

### Active — slight dimming

```css
.surface-glass:active {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.65) 0%,
    rgba(255, 255, 255, 0.55) 100%
  );
  transition-duration: 0.1s;
}
```

### Focus-visible — accent ring

```css
.surface-glass:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

No transitions on `box-shadow` or `backdrop-filter` — they are expensive. Only transition `background`, `border-color`, and `opacity`.

---

## 4. CSS Custom Properties to Add

Add to `:root` in `styles.css`:

```css
/* ─── Frosted Glass Tokens ─── */

--glass-1-bg: linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.68));
--glass-1-blur: blur(32px) saturate(140%);
--glass-1-border: rgba(0,0,0,0.04);

--glass-2-bg: linear-gradient(180deg, rgba(255,255,255,0.62), rgba(255,255,255,0.50));
--glass-2-blur: blur(24px) saturate(130%);
--glass-2-border: rgba(0,0,0,0.06);

--glass-3-bg: linear-gradient(180deg, rgba(255,255,255,0.48), rgba(255,255,255,0.36));
--glass-3-blur: blur(16px) saturate(120%);
--glass-3-border: rgba(255,255,255,0.35);

--shadow-glass-1:
  0 24px 48px -12px rgba(0,0,0,0.06),
  0 8px 16px -4px rgba(0,0,0,0.02),
  inset 0 1px 0 rgba(255,255,255,0.85);

--shadow-glass-2:
  0 8px 24px -4px rgba(0,0,0,0.04),
  0 2px 6px rgba(0,0,0,0.02),
  inset 0 1px 0 rgba(255,255,255,0.7);

--shadow-glass-3:
  0 4px 12px rgba(0,0,0,0.03),
  inset 0 1px 0 rgba(255,255,255,0.5);
```

Note: CSS custom properties cannot store `backdrop-filter` values directly. The blur is applied via utility classes or directly in component rules. The tokens above capture background gradient and border color for easy reuse.

---

## 5. Component Assignment Map

### Which components use which glass layer.

| Component | Current CSS class | Glass Layer | Rationale |
|-----------|-------------------|-------------|-----------|
| **App viewport** | `.app-shell__viewport` | Glass 1 | Primary container — needs strongest blur and highest readability |
| **Settings hero** | `.settings-surface__hero` | Glass 1 | Header surface, same role as viewport |
| **Settings nav panel** | `.settings-surface__nav-panel` | Glass 1 | Persistent navigation, primary surface |
| **Settings content panel** | `.settings-surface__content-panel` | Glass 1 | Primary content area |
| **Hierarchy panel** | `.workspace-hierarchy-panel` | Glass 2 | Secondary panel inside viewport — one layer below |
| **Archive cards** | `.archive-card` | Glass 2 | Cards floating over the primary surface |
| **Modal panel** | `.modal-panel` | Glass 2 | Floating dialog over viewport |
| **Provider floating card** | `.provider-floating-card` | Glass 2 | Popover, floating over viewport |
| **Radial menu track** | `.radial-menu__track` | Glass 3 | Transient decorative background ring |
| **Radial menu items** | `.radial-menu__item` | Glass 2 | Interactive items on the track — need Glass 2 for clarity |
| **Route item (active)** | `.route-item--active` | No glass | Keep solid — active state should be crisp, not blurred |
| **Terminal screen** | `.terminal-screen` | No glass | Dark surface, blur would be invisible — keep solid dark |
| **Activity bar** | `.activity-bar` | No glass | Transparent by design — navigation chrome, not a surface |
| **Placeholder surfaces** | `.placeholder-surface__lane` | No glass | Keep light solid background for clarity |

### Why these assignments

- **Glass 1** goes on surfaces that directly sit over the canvas background. They need strong blur because the canvas gradient and body background show through.
- **Glass 2** goes on elements floating over a Glass 1 surface. Less blur is needed because Glass 1 already provides diffusion.
- **Glass 3** is only for transient, decorative, or non-interactive backgrounds.
- **No glass** for dark surfaces (terminal) where blur is invisible, and for interactive items that need pixel-crisp borders (active route items).

---

## 6. Per-Component Migration Detail

### 6.1 `.app-shell__viewport` → Glass 1

```css
.app-shell__viewport {
  /* Before:
    background: var(--surface);
    backdrop-filter: blur(40px) saturate(120%);
    border: 1px solid rgba(0, 0, 0, 0.04);
    box-shadow: var(--shadow-premium), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  */

  background: linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.68));
  backdrop-filter: blur(32px) saturate(140%);
  -webkit-backdrop-filter: blur(32px) saturate(140%);
  border: 1px solid rgba(0, 0, 0, 0.04);
  box-shadow: var(--shadow-glass-1);
}
```

### 6.2 `.settings-surface__hero` → Glass 1

```css
.settings-surface__hero {
  background: linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.68));
  backdrop-filter: blur(32px) saturate(140%);
  -webkit-backdrop-filter: blur(32px) saturate(140%);
  border: 1px solid rgba(0, 0, 0, 0.04);
  box-shadow: var(--shadow-glass-1);
}
```

### 6.3 `.settings-surface__nav-panel` + `.settings-surface__content-panel` → Glass 1

Same recipe as 6.2.

### 6.4 `.workspace-hierarchy-panel` → Glass 2

```css
.workspace-hierarchy-panel {
  /* Before:
    background: rgba(255, 255, 255, 0.4);
    border: 1px solid rgba(0, 0, 0, 0.06);
  */

  background: linear-gradient(180deg, rgba(255,255,255,0.62), rgba(255,255,255,0.50));
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: var(--shadow-glass-2);
}
```

### 6.5 `.archive-card` → Glass 2

```css
.archive-card {
  background: linear-gradient(180deg, rgba(255,255,255,0.62), rgba(255,255,255,0.50));
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: var(--shadow-glass-2);
}

.archive-card:hover {
  background: linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.60));
  border-color: rgba(0, 0, 0, 0.08);
}
```

### 6.6 `.modal-panel` → Glass 2

```css
.modal-panel {
  /* Before:
    background: var(--surface-solid);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-premium);
  */

  background: linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.70));
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow:
    0 24px 48px -12px rgba(0, 0, 0, 0.12),
    0 8px 16px -4px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
```

Modal sits over a `rgba(0,0,0,0.45)` overlay, so higher outer shadow values compensate.

### 6.7 `.provider-floating-card` → Glass 2

```css
.provider-floating-card {
  background: linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.58));
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: var(--shadow-glass-2);
}
```

### 6.8 `.radial-menu__track` → Glass 3

```css
.radial-menu__track {
  background: linear-gradient(180deg, rgba(255,255,255,0.48), rgba(255,255,255,0.36));
  backdrop-filter: blur(16px) saturate(120%);
  -webkit-backdrop-filter: blur(16px) saturate(120%);
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: var(--shadow-glass-3);
}
```

### 6.9 `.radial-menu__item` → Glass 2

```css
.radial-menu__item {
  background: linear-gradient(180deg, rgba(255,255,255,0.68), rgba(255,255,255,0.52));
  backdrop-filter: blur(24px) saturate(130%);
  -webkit-backdrop-filter: blur(24px) saturate(130%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: var(--shadow-glass-2);
}

.radial-menu__item:hover {
  background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.70));
}
```

---

## 7. Components That Stay Solid

These intentionally do **not** get frosted glass:

| Component | Reason |
|-----------|--------|
| `.terminal-screen` | Dark surface; backdrop-filter on dark backgrounds produces no visible blur effect |
| `.terminal-viewport__overlay` | Same — dark themed |
| `.route-item--active` | Active navigation needs crisp borders and high contrast, not diffusion |
| `.settings-tab-bar__item--active` | Same — active state reads better as solid white |
| `.settings-card` | Solid cards inside glass panels provide text contrast anchor |
| `.placeholder-card` | Same — structural cards |
| `.form-field__input` | Input fields need opaque backgrounds for text legibility |
| `.activity-bar` | Transparent by design; not a surface |
| `.button-primary` / `.button-ghost` | Buttons need solid affordance |

---

## 8. Visual Hierarchy Summary

```
Canvas background (body gradient)
  └─ Glass 1: app-shell__viewport          ← strongest blur, highest opacity
      ├─ Glass 2: hierarchy panel           ← secondary, softer
      ├─ Glass 2: modal panel               ← floating
      ├─ Glass 2: floating card             ← popover
      └─ Glass 3: radial menu track         ← faintest, decorative
           └─ Glass 2: radial menu items    ← items sharper than track
```

Nested glass layers stack: each level adds its own blur on top of the previous. This is why inner layers use *less* blur — the cumulative effect would be too diffuse otherwise.

---

## 9. Performance Notes

- `backdrop-filter` triggers GPU compositing. Each glass surface creates a compositing layer.
- Limit to **no more than 3 simultaneous glass layers** visible at once (e.g., viewport + hierarchy panel + one floating element).
- Never animate `backdrop-filter` or `box-shadow`. Only animate `background`, `border-color`, and `opacity`.
- In Electron (Chromium), `backdrop-filter` is well-optimized. No polyfill needed.

---

## 10. Migration Checklist

- [ ] Add glass tokens to `:root` in `styles.css`
- [ ] Migrate `.app-shell__viewport` to Glass 1
- [ ] Migrate `.settings-surface__hero` to Glass 1
- [ ] Migrate `.settings-surface__nav-panel` to Glass 1
- [ ] Migrate `.settings-surface__content-panel` to Glass 1
- [ ] Migrate `.workspace-hierarchy-panel` to Glass 2
- [ ] Migrate `.archive-card` to Glass 2
- [ ] Migrate `.modal-panel` to Glass 2
- [ ] Migrate `.provider-floating-card` to Glass 2
- [ ] Migrate `.radial-menu__track` to Glass 3
- [ ] Migrate `.radial-menu__item` to Glass 2
- [ ] Remove old `--surface` / `--surface-soft` references from migrated components
- [ ] Visual QA — verify readability, nesting, hover states
