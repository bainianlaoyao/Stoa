# Liquid Glass Surface Design

Date: 2026-04-23

## Goal

Introduce a project-owned Vue Liquid Glass primitive based on the visual and interaction model from `rdev/liquid-glass-react`, then use it for the session type radial selector opened from the add-session long press.

This is not a radial-menu-only implementation. The first consumer is `ProviderRadialMenu.vue`, but the primitive must be reusable by future panels, controls, modal surfaces, floating cards, and preview components.

## Constraints

- Follow `docs/engineering/design-language.md` as the visual authority.
- Use project tokens for colors, shadows, radii, typography, and surface treatment.
- Do not add compatibility migration paths. The current radial selector visual implementation can be replaced as a breaking change.
- Preserve the current radial menu behavior: long press opens the menu, releasing on a provider creates the session, keyboard click still works, non-primary mouseup is ignored.
- `npx vitest run` must pass before implementation is considered complete, with only the known `sandbox: false` guard failure tolerated if it still exists.

## Source Basis

The implementation should be adapted from `rdev/liquid-glass-react` rather than wrapped as a React dependency. The relevant behavior is:

- SVG filter pipeline using displacement maps and `feDisplacementMap`.
- RGB channel displacement for chromatic aberration.
- Edge mask and overlay highlights.
- Mouse-position-driven elastic translation and scale.
- Refraction modes including `standard`, `polar`, `prominent`, and `shader`; the first project API should expose only `standard | polar | prominent`.

The npm Vue package `@aslanonur/liquid-glass-vue` is useful as a reference because it ports much of the React package, but it only exposes `standard | polar`. The project needs `prominent` for a stronger circular selector surface and future high-emphasis UI surfaces.

References:

- `https://github.com/rdev/liquid-glass-react`
- `https://www.npmjs.com/package/liquid-glass-react`
- `https://www.npmjs.com/package/@aslanonur/liquid-glass-vue`

## Recommended Architecture

Create a local primitive module under:

```text
src/renderer/components/primitives/liquid-glass/
```

Core files:

- `LiquidGlassSurface.vue` is the public Vue component for consumers.
- `LiquidGlassFilter.vue` owns the SVG filter definitions and displacement map selection.
- `useLiquidGlass.ts` owns pointer tracking, size measurement, elastic transform calculation, and generated filter IDs.
- `displacement-maps.ts` owns the imported/adapted displacement map data URLs.
- `types.ts` owns shared prop and mode types.
- `LiquidGlassSurface.test.ts` validates reusable behavior.

This keeps the effect reusable while avoiding a large monolithic component. It also isolates the copied/adapted algorithmic pieces from business components.

## Public Component Contract

`LiquidGlassSurface.vue` should expose a clear project API:

```ts
type LiquidGlassMode = 'standard' | 'polar' | 'prominent'

interface LiquidGlassSurfaceProps {
  mode?: LiquidGlassMode
  displacementScale?: number
  blurAmount?: number
  saturation?: number
  aberrationIntensity?: number
  elasticity?: number
  cornerRadius?: number
  padding?: string
  overLight?: boolean
  interactive?: boolean
  positioning?: 'relative' | 'fixed'
  globalMousePos?: { x: number; y: number }
  mouseOffset?: { x: number; y: number }
  mouseContainer?: HTMLElement | null
}
```

`shader` mode should not be part of the first public API. It requires canvas-generated maps and has more stability/performance risk. Because this project is in prototype development, it can be added later as a breaking change if needed.

Defaults should be tuned for the project, not copied directly from React:

- `mode: 'standard'`
- `displacementScale: 48`
- `blurAmount: 0.08`
- `saturation: 150`
- `aberrationIntensity: 2`
- `elasticity: 0.18`
- `cornerRadius: 999`
- `padding: '0'`
- `overLight: true`
- `interactive: false`
- `positioning: 'relative'`

## Visual Design

The primitive creates the Liquid Glass medium; consumers still control layout. The component should render:

- A decorative shadow/tint layer using tokenized CSS variables.
- A glass container with the SVG displacement filter applied to the backdrop warp layer.
- A content layer for slotted children.
- A highlight/border layer using low-opacity tokenized white/line treatment.

Hardcoded React defaults such as large black shadows, white text styles, and Tailwind utility classes must not be carried over. The local CSS should use project variables such as `var(--surface)`, `var(--line)`, `var(--white-soft)`, `var(--shadow-card)`, and `var(--text-strong)`.

## Radial Menu Application

`ProviderRadialMenu.vue` should use `LiquidGlassSurface` for the session type selection disk.

The existing menu behavior remains:

- The menu is teleported to `body`.
- The menu center is derived from the add-session button.
- Provider items keep their current ARIA labels.
- Primary mouseup creates a session.
- Keyboard click creates a session.
- Non-primary mouseup does nothing.

The visual structure changes:

- `radial-menu__track` becomes a `LiquidGlassSurface` disk instead of a plain decorative ring.
- Use `mode="prominent"` for the disk.
- Keep provider icons as absolute positioned children above the glass content layer.
- Use a larger disk than the current 104px track so the glass medium feels intentional; target 128px with icon radius around 48px.
- The provider icon buttons should be transparent controls seated on the glass disk, with restrained hover feedback from tokens.

The radial menu should not create its own custom glass algorithm. It should only set consumer-level props:

```vue
<LiquidGlassSurface
  class="radial-menu__glass"
  mode="prominent"
  :corner-radius="999"
  :displacement-scale="56"
  :blur-amount="0.08"
  :saturation="160"
  :aberration-intensity="2"
  :elasticity="0.22"
  :over-light="true"
  interactive
>
  <!-- provider buttons -->
</LiquidGlassSurface>
```

## Data Flow

`ProviderRadialMenu` owns only radial geometry and create/close events. `LiquidGlassSurface` owns all glass measurement and pointer response.

Pointer flow:

1. `LiquidGlassSurface` measures its element size on mount and resize.
2. Pointer movement updates local or externally supplied mouse coordinates.
3. The component derives elastic translation, directional scale, and highlight angle.
4. CSS variables or inline style values drive the visual layers.

No Pinia state, IPC, backend state, or persisted data changes are involved.

## Error Handling

The primitive should degrade internally if measurements are unavailable during first render:

- Use a deterministic default size for the SVG filter.
- Render children normally before the first measurement.
- Do not throw if `mouseContainer` is null.

This is not browser compatibility code. It is normal render-lifecycle handling for Vue and test environments.

## Testing

Add component tests for the primitive:

- Renders slotted content.
- Generates an SVG filter with a stable `url(#...)` reference.
- Supports `standard`, `polar`, and `prominent` modes.
- Applies configurable props to style/filter attributes.
- Handles missing measurement APIs without throwing.

Update `ProviderRadialMenu.test.ts`:

- Assert the radial menu renders the Liquid Glass disk class.
- Keep existing behavioral tests for provider labels and create events.
- Update geometry expectations if disk size/radius changes.
- Do not add `as any`, `@ts-ignore`, or `@ts-expect-error`.

Run:

```bash
npx vitest run
```

## Non-Goals

- Do not add React as a dependency.
- Do not wrap `liquid-glass-react` at runtime.
- Do not introduce `@aslanonur/liquid-glass-vue` as the primary implementation.
- Do not implement `shader` mode in the first pass.
- Do not redesign the session creation flow beyond replacing the radial selector surface.
- Do not apply Liquid Glass globally to all panels in this first implementation.

## Acceptance Criteria

- A project-owned Liquid Glass primitive exists and can be imported by future components.
- The radial session type selector uses the primitive for its disk.
- The selector looks like a liquid glass surface, with visible displacement, edge highlight, and restrained elastic response.
- Existing radial menu create/close behavior remains covered by tests.
- Visual styles follow the Modern Minimalist Glassmorphism + Clean UI design language.
- `npx vitest run` passes with zero unexpected failures.
