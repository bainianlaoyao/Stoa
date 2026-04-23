# Frosted Glass Design Specification

> Frosted glass is reserved for transient, floating surfaces. Everything permanent stays solid.

## 1. Design Philosophy

**Glass = transient signal.** Frosted glass is not a decoration — it communicates "this surface is temporary, floating above the stable UI." Permanent surfaces (viewport, panels, cards) stay crisp and opaque.

Single principle: **Only things that appear and disappear use glass.**

---

## 2. Glass Layer

One glass recipe. One role.

| Token | Background | Blur | Border | Shadow | Role |
|-------|-----------|------|--------|--------|------|
| `--glass` | `rgba(255,255,255, 0.82→0.72)` | `blur(24px) saturate(120%)` | `rgba(0,0,0,0.06)` | `--shadow-glass` | All transient floating surfaces |

### Shadow definition

```css
--shadow-glass:
  0 12px 32px -4px rgba(0, 0, 0, 0.08),
  0 4px 12px rgba(0, 0, 0, 0.03),
  inset 0 1px 0 rgba(255, 255, 255, 0.85);
```

### Compositing recipe

```css
.glass {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.85) 0%,
    rgba(255, 255, 255, 0.72) 100%
  );
  backdrop-filter: blur(24px) saturate(120%);
  -webkit-backdrop-filter: blur(24px) saturate(120%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: var(--shadow-glass);
}
```

---

## 3. Interaction States

### Hover — gentle brightening

```css
.glass:hover {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.92) 0%,
    rgba(255, 255, 255, 0.80) 100%
  );
  border-color: rgba(0, 0, 0, 0.08);
}
```

### Focus-visible — accent ring

```css
.glass:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Only transition `background` and `border-color`. Never `box-shadow` or `backdrop-filter`.

---

## 4. CSS Custom Properties

Add to `:root` in `styles.css`:

```css
--shadow-glass:
  0 12px 32px -4px rgba(0, 0, 0, 0.08),
  0 4px 12px rgba(0, 0, 0, 0.03),
  inset 0 1px 0 rgba(255, 255, 255, 0.85);
```

---

## 5. Component Assignment

### Uses glass (transient)

| Component | CSS class | Why glass |
|-----------|-----------|-----------|
| Modal panel | `.modal-panel` | Appears over overlay, disappears on close |
| Provider floating card | `.provider-floating-card` | Popover, appears on click |
| Radial menu track | `.radial-menu__track` | Appears on long-press, disappears on release |
| Radial menu items | `.radial-menu__item` | Same as track — temporary interaction |

### Stays solid (permanent)

| Component | CSS class | Why solid |
|-----------|-----------|-----------|
| App viewport | `.app-shell__viewport` | Always visible |
| Activity bar | `.activity-bar` | Always visible |
| Hierarchy panel | `.workspace-hierarchy-panel` | Always visible |
| Settings hero | `.settings-surface__hero` | Always visible |
| Settings nav panel | `.settings-surface__nav-panel` | Always visible |
| Settings content panel | `.settings-surface__content-panel` | Always visible |
| Settings cards | `.settings-card` | Always visible |
| Archive cards | `.archive-card` | Always visible |
| Terminal screen | `.terminal-screen` | Always visible |
| Route items | `.route-item` | Always visible |
| Buttons | `.button-primary` / `.button-ghost` | Always visible |
| Form inputs | `.form-field__input` | Always visible |
| Placeholder surfaces | `.placeholder-surface__lane` | Always visible |

---

## 6. Per-Component Migration Detail

### 6.1 `.modal-panel` → glass

```css
.modal-panel {
  background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.72));
  backdrop-filter: blur(24px) saturate(120%);
  -webkit-backdrop-filter: blur(24px) saturate(120%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow:
    0 20px 48px -12px rgba(0, 0, 0, 0.10),
    0 8px 16px -4px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.85);
  /* Modal gets slightly larger outer shadow to stand out over overlay */
}
```

### 6.2 `.provider-floating-card` → glass

```css
.provider-floating-card {
  background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.72));
  backdrop-filter: blur(24px) saturate(120%);
  -webkit-backdrop-filter: blur(24px) saturate(120%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: var(--shadow-glass);
}
```

### 6.3 `.radial-menu__track` → glass (lighter variant)

```css
.radial-menu__track {
  background: linear-gradient(180deg, rgba(255,255,255,0.60), rgba(255,255,255,0.42));
  backdrop-filter: blur(20px) saturate(120%);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  border: 1px solid rgba(255, 255, 255, 0.30);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 0.60);
}
```

Track is slightly more transparent than items — it's decorative, items carry the interaction.

### 6.4 `.radial-menu__item` → glass

```css
.radial-menu__item {
  background: linear-gradient(180deg, rgba(255,255,255,0.80), rgba(255,255,255,0.65));
  backdrop-filter: blur(24px) saturate(120%);
  -webkit-backdrop-filter: blur(24px) saturate(120%);
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: var(--shadow-glass);
}

.radial-menu__item:hover {
  background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.80));
}
```

---

## 7. Migration Checklist

- [ ] Add `--shadow-glass` token to `:root`
- [ ] Migrate `.modal-panel` to glass
- [ ] Migrate `.provider-floating-card` to glass
- [ ] Migrate `.radial-menu__track` to glass (lighter)
- [ ] Migrate `.radial-menu__item` to glass
- [ ] Visual QA — verify glass only appears on transient surfaces
