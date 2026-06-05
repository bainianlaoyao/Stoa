# Changelog

## v0.3.3 (2026-06-05)

### Fixed

- **Session title generation prompt rewritten**: Auto-generated session titles were generic and uninformative (e.g. "Implement project-name"). The system prompt now emphasizes specific work descriptions with good/bad examples; project name and session provider were removed from the LLM input to prevent the model from taking shortcuts

## v0.3.2 (2026-06-05)

### Bug Fix

- **stoa-ctl bootstrap prompt no longer injected when disabled**: The bootstrap prompt containing session commands and protocol instructions was unconditionally injected into every `SessionStart` event, even when `stoa-ctl` was disabled in Settings. The 4-point gate correctly controlled shims, PATH, env vars, and HTTP endpoints, but bootstrap prompt injection was never gated. The `SessionEventBridge` now checks `stoaCtlGate.isEnabled()` before injecting the prompt.

## v0.3.1 (2026-06-03)

### stoa-ctl Settings Toggle

Users can now dynamically enable/disable the `stoa-ctl` command-line control plane from the app settings UI. **Disabled by default (opt-in)** — upgrading users will need to manually enable it.

- **New setting**: `stoa-ctl command-line control` toggle in Settings → Advanced
- **Default**: Off. No shim, no PATH registration, no `/ctl/*` HTTP endpoints until explicitly enabled
- **4-point gate**: When disabled, all exposure surfaces are sealed:
  - Per-session bin shim not created
  - System shim + PATH registration (`~/.stoa/bin`) removed
  - Sub-session env stripped of `STOA_CTL_COMMAND` / `STOA_CTL_SESSION_TOKEN`
  - HTTP `/ctl/*` returns `503 { error: { code: 'disabled' } }`
- **Runtime toggle**: Changes take effect immediately for new sessions; running sessions continue with their existing env
- **Advanced settings tab**: New "Advanced" tab in Settings surface for CLI and experimental features

### Breaking Changes

- `stoa-ctl` is **disabled by default**. Previous users of `stoa-ctl` must enable it in Settings → Advanced after upgrading
- `meta-session-command-env.ts` removed (zero call sites — dead code cleanup)

### Other Changes

- `ProjectSessionManager` now emits `settings:updated` event on setting changes
- Fluent 2 design language adoption for renderer components
- stoa-ctl subsession control completion
