# Frontend Semantic Requirements

Every Vue component must satisfy the semantic and accessibility contracts enforced by the 4-tier test suite. This document defines those contracts.

## 1. Region Contract

Every distinct visual area must be a named `<section>` or `<aside>` with `role="region"` and a unique `aria-label`.

```html
<!-- ✅ Correct -->
<section role="region" aria-label="Terminal surface">
<aside aria-label="Workspace hierarchy">

<!-- ❌ Wrong — no accessible name -->
<section role="region">
```

### Required region names (existing)

| Component | aria-label |
|---|---|
| TerminalViewport (running) | `"Terminal surface"` |
| TerminalViewport (non-running) | `"Session details"` |
| TerminalViewport (empty) | `"Terminal empty state"` |
| CommandSurface | `"Command surface"` |
| SettingsSurface | `"Settings surface"` |

New components with visual surfaces must add their own unique region name and register it here.

## 2. Navigation Contract

Navigation elements must use `<nav>` with `aria-label`.

```html
<nav aria-label="Global activity">
```

Active navigation items must set `aria-current="true"` on the button.

## 3. Dialog Contract

Modals must use `role="dialog"` with either:
- `aria-labelledby` pointing to a visible `<h2>` inside the dialog, OR
- `aria-label` with a descriptive name

```html
<div role="dialog" aria-labelledby="modal-title">
  <h2 id="modal-title">Create Session</h2>
</div>
```

## 4. Alert Contract

Validation errors and status notifications must use `role="alert"`.

```html
<p role="alert">Session creation failed</p>
```

## 5. Button Contract

Every `<button>` must have either:
- Visible text content, OR
- `aria-label` describing its action

```html
<button aria-label="Add session to infra-control">+</button>
<button aria-label="Command panel">
```

## 6. Metadata List Contract

Key-value metadata displays must use `<dl>` with `aria-label`.

```html
<dl aria-label="Session metadata">
  <div>
    <dt>Session</dt>
    <dd>{{ session.title }}</dd>
  </div>
</dl>
```

## 7. Described-By Contract

Regions that have a primary description must link to it via `aria-describedby`.

```html
<section aria-describedby="summary-id">
  <p id="summary-id">Process completed with code 0.</p>
</section>
```

## 8. Output Contract

Elements that display computed results must use `<output>` with `aria-label`.

```html
<output aria-label="Primary action count">{{ count }}</output>
```

## 9. Surface Data Attribute

Top-level surface containers must include `data-surface="<name>"` for boot-integrity smoke checks.

```html
<section data-surface="command" aria-label="Command surface">
```

## Test Locator Strategy

| Priority | Locator type | When to use |
|---|---|---|
| 1 | `getByRole` / `getByLabel` | Default for all assertions |
| 2 | `data-testid` | Fallback when semantic query insufficient |
| 3 | CSS selector | Boot-integrity smoke checks, canvas/terminal shells only |

If a test cannot find an element via semantic locators, fix the component semantics first — do not fall back to CSS selectors.
