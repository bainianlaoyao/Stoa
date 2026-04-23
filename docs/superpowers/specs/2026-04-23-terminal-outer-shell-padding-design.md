# Terminal Outer Shell Padding Design

## Goal

Re-introduce visual breathing room around the live xterm terminal without changing xterm's measured render box.

The terminal content area must remain geometry-safe:

- no padding on `.xterm`
- no padding on the actual xterm mount used by `open()`
- no change to `FitAddon` sizing assumptions
- no regression to the existing fix for compressed text/icons

## Chosen Direction

Use an **outer responsive shell** around the terminal mount.

This shell provides the padding effect visually, while the inner terminal surface remains edge-to-edge inside its own rendering box.

Visual intent:

- closest to the approved `A1` mockup
- light shell presence
- subtle breathing room
- restrained border and depth
- responsive spacing on desktop and narrower windows

## Structure

Running state layout becomes:

1. `terminal-viewport__xterm`
   This remains the top-level live-terminal region.

2. `terminal-viewport__shell`
   New outer wrapper responsible for responsive spacing and shell presentation.

3. `terminal-viewport__xterm-mount`
   Inner mount passed to `xterm.open()`. This stays free of layout padding that would affect xterm geometry.

The mount remains the xterm host. The shell is visual-only.

## Styling Rules

### Shell spacing

Use responsive tokenized spacing with `clamp()`.

Target behavior:

- compact windows: roughly `10px`
- normal desktop: roughly `14px`
- wider desktop: cap around `18px`

Recommended token:

```css
--terminal-shell-gap: clamp(10px, 1.4vw, 18px);
```

### Shell presentation

The shell should preserve the existing design language:

- background stays in the terminal dark family
- border remains low-contrast
- radius slightly larger than the inner terminal frame
- depth remains subtle, closer to `A1` than `A3`

Recommended treatment:

- outer shell uses `var(--terminal-bg)` or a terminal-adjacent token
- shell border uses `var(--terminal-border)`
- shell radius stays tokenized
- optional faint inset/highlight only if needed for separation

### Inner terminal frame

The inner terminal area should remain visually crisp and dense:

- xterm mount fills the shell interior
- no extra padding on `.xterm`
- no extra padding on `.xterm-viewport`
- scrollbar hiding remains unchanged

## Responsive Behavior

The shell must shrink automatically on narrower widths.

Rules:

- spacing derives from `clamp()`, not hardcoded breakpoints alone
- desktop keeps the intended breathing room
- smaller widths reduce shell gap before the terminal becomes cramped
- terminal width must always remain the primary priority over decorative spacing

Optional small-screen refinement is allowed if needed:

- tighten shell gap further under the existing narrow layout breakpoint

## Accessibility and Behavior

No behavioral changes:

- same terminal input path
- same replay/live merge behavior
- same resize behavior
- same session-state switching behavior

No new compatibility code or migration behavior.

## Test Impact

Add or update tests to lock the design in place:

1. Running live terminal includes the new shell wrapper.
2. xterm mount remains inside the shell wrapper.
3. Geometry-safe guarantee remains:
   running state must not reintroduce padding on `.xterm`.
4. Existing resize/fit behavior must still pass.

The full repository quality gate remains:

```bash
npx vitest run
```

## Implementation Boundaries

Limit changes to:

- `src/renderer/components/TerminalViewport.vue`
- related terminal viewport tests
- shared renderer tokens only if a new shell-gap token is required

Do not change:

- xterm runtime sizing logic
- `lineHeight`
- FitAddon workflow
- renderer-wide terminal behavior outside the shell presentation
