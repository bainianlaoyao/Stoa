---
date: 2026-04-24
topic: settings scroll issue scope analysis
status: completed
mode: context-gathering
sources: 5
---

## Context Report: Settings Surface Scroll Issue

### Why This Was Gathered
User reports the settings interface cannot scroll vertically. Need to determine if this is a settings-only bug or a shared layout issue across all surfaces.

### Summary
This is a **settings-only issue**. The root cause is a CSS height constraint chain break: the AppShell viewport uses `overflow-hidden` (clips content), the settings content panel has `overflow: auto` (intended scroll container), but the parent `.settings-surface` uses `min-height: 100%` + `align-content: start` which causes it to grow with content rather than stay bounded — so `overflow: auto` on the child never triggers because there's no height ceiling.

### Key Findings

1. **AppShell viewport is correct** — uses `overflow-hidden` with `min-h-0` to create a bounded viewport. Other surfaces (CommandSurface, ArchiveSurface) scroll correctly within it.
2. **SettingsSurface lacks height constraint** — `.settings-surface` uses `min-height: 100%` (line 83) which makes it expand with content instead of staying within the viewport bounds. Without an explicit `height: 100%` or `max-height` constraint, the `overflow: auto` on `.settings-surface__content-panel` (line 181) never activates.
3. **Shared `settings-panel` utility adds `min-height: 100%`** — defined in `tailwind.css:179-185`, this class is used by GeneralSettings, ProvidersSettings, and AboutSettings. It further prevents scroll context from forming.
4. **ArchiveSurface works correctly** — uses explicit `height: 100%` + `min-height: 0` + `overflow: auto` chain (`ArchiveSurface.vue:70-83`), which is the correct pattern.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| AppShell viewport clips with overflow-hidden | AppShell.vue | `:48` |
| `.settings-surface` uses min-height:100% (grows, not bounded) | SettingsSurface.vue | `:80-86` |
| `.settings-surface__shell` has min-height:0 but no height | SettingsSurface.vue | `:146-151` |
| `.settings-surface__content-panel` has overflow:auto but never triggers | SettingsSurface.vue | `:180-188` |
| `settings-panel` utility has min-height:100% | tailwind.css | `:179-185` |
| ArchiveSurface works: height:100% + overflow:auto | ArchiveSurface.vue | `:70-83` |

### Root Cause Analysis

The height constraint chain breaks at `.settings-surface`:

```
AppShell viewport (bounded, overflow:hidden)
  └─ .settings-surface (min-height:100%, NO height/max-height → GROWS)
       └─ .settings-surface__shell (min-height:0, but parent has no ceiling)
            └─ .settings-surface__content-panel (overflow:auto, but never overflows)
```

Fix needs:
- `.settings-surface`: add `height: 100%` and `overflow: hidden` (or remove `min-height: 100%`)
- `.settings-surface__shell`: add `min-height: 0` (already has it) + ensure grid stretches
- `settings-panel` utility: change `min-height: 100%` → `min-height: 0` or remove it

### Risks / Unknowns
- [!] Changing `settings-panel` utility affects all three settings tabs — verify none rely on `min-height: 100%` for layout
- [?] The hero section at the top takes fixed space — content panel may need `flex: 1` or `min-height: 0` within the grid to properly shrink
