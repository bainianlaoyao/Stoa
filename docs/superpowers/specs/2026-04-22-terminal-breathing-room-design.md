# Terminal Breathing Room

Date: 2026-04-22
Status: Draft

## Confirmed Decision

The terminal should keep its current dark card footprint, but gain a more obvious internal gutter so the live text no longer feels pressed against the black frame. The chosen direction is:

- Keep the outer terminal card in place
- Add a dedicated inner mount layer for the running xterm surface
- Tokenize the spacing instead of hardcoding one-off visual constants

## Problem

The current running terminal state renders xterm directly inside `.terminal-viewport__xterm` and only gives `.xterm` a `4px` padding. This technically separates content from the card edge, but visually it still reads as text touching the terminal frame.

That makes the terminal feel harsher than the rest of the interface, which already uses restrained spacing, soft layering, and token-driven surfaces.

## Goals

1. Give the terminal content visible breathing room on all sides
2. Preserve the current command surface layout and dark terminal identity
3. Keep the change aligned with `docs/engineering/design-language.md`
4. Make spacing reusable through shared tokens

## Non-Goals

- No compatibility layer or migration path
- No redesign of the inactive overlay state
- No change to terminal behavior, session wiring, or resize semantics
- No redesign of sidebar, meta model, or app shell layout

## Decision

Introduce a dedicated inner gutter wrapper between the black terminal card and the xterm mount node.

Instead of relying on a tiny padding directly on `.xterm`, the running state will use a clear two-layer structure:

1. Outer terminal card: preserves the dark shell, border radius, and clipping
2. Inner terminal mount: creates the breathing room and hosts the xterm instance

This keeps the visual hierarchy clean:

- The black card still defines the terminal region
- The inner mount defines the readable content boundary
- The text feels inset by design, not by accident

## Architecture

### Current

```text
terminal-viewport__xterm
└── .xterm
```

### New

```text
terminal-viewport__xterm
└── terminal-viewport__xterm-shell
    └── terminal-viewport__xterm-mount
        └── .xterm
```

## Styling Strategy

### Token additions

Add terminal-specific spacing tokens in `src/renderer/styles.css`:

- `--terminal-shell-padding`
- `--terminal-content-padding`

These tokens define the internal gutter and fine-grained text inset. The exact values should create a clearly noticeable improvement over the current `4px`, while still feeling disciplined inside the compact command surface.

### Component styling

`TerminalViewport.vue` will be updated so that:

- `.terminal-viewport__xterm` remains the full-size dark host with clipping and radius
- `.terminal-viewport__xterm-shell` creates the main inset around the live terminal
- `.terminal-viewport__xterm-mount` fills the remaining area and becomes the actual `terminal.open(...)` target
- `.xterm` uses token-backed inner padding rather than a fixed micro-padding

### Visual intent

The terminal should read as:

- premium and composed, not cramped
- slightly softer than raw xterm defaults
- still clearly a tooling surface, not a decorative card

No extra inner border, no extra glass effect, and no ornamental framing should be introduced in this task.

## Component Changes

### `src/renderer/components/TerminalViewport.vue`

- Change the running-state template from a single mount div to nested shell + mount structure
- Move the `ref="terminalContainer"` to the inner mount node
- Update scoped styles for the new wrapper classes
- Replace fixed `.xterm { padding: 4px; }` with token-driven spacing

### `src/renderer/styles.css`

- Add terminal spacing tokens to `:root`
- Keep the existing terminal palette and radius tokens unchanged

## Behavioral Impact

There should be no behavior change in:

- session start and stop
- terminal input and output
- resize observation
- xterm fit lifecycle
- exit message rendering

The change is visual and structural only.

## Testing Plan

### Update `src/renderer/components/TerminalViewport.test.ts`

Add assertions for the new running-state structure:

- running state renders `.terminal-viewport__xterm-shell`
- running state renders `.terminal-viewport__xterm-mount`
- the xterm outer host still exists

Existing tests covering resize registration and overlay behavior should continue to pass unchanged.

### Full suite verification

Run:

```bash
npx vitest run
```

Per repository rules, the work is not complete until the suite passes with zero unexpected failures.

## Design Language Compliance

- Uses shared tokens instead of ad hoc visual constants
- Preserves the existing dark tooling surface rather than introducing conflicting UI language
- Improves hierarchy through spacing and containment, not heavy framing
- Keeps mono typography and terminal semantics intact

## Risks

### Risk: FitAddon sizing mismatch

Because the mount target moves one level deeper, the fit calculation must still observe the correct node size. The implementation should keep the `ResizeObserver` attached to the same effective mount element used by xterm.

### Risk: Over-padding in compact layouts

The spacing needs to feel intentional without shrinking the usable terminal too aggressively on smaller windows. The token values should therefore stay moderate, even though the change is intentionally more visible than the current state.
