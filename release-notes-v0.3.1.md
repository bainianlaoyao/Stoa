# Stoa v0.3.1

## stoa-ctl Settings Toggle

Users can now dynamically enable/disable the `stoa-ctl` command-line control plane from the app settings UI.

**Disabled by default (opt-in).** Upgrading users will need to manually enable it in Settings → Advanced.

### New Setting

`stoa-ctl command-line control` toggle in **Settings → Advanced**.

### 4-Point Gate

When disabled, all exposure surfaces are sealed:

- Per-session bin shim is not created
- System shim + PATH registration (`~/.stoa/bin`) is removed
- Sub-session env is stripped of `STOA_CTL_COMMAND` / `STOA_CTL_SESSION_TOKEN`
- HTTP `/ctl/*` returns `503 { error: { code: 'disabled' } }`

When enabled, all surfaces are restored and the gateway publishes a single `stoaCtlGate` truth source so the toggle propagates consistently to new sessions.

### Breaking Changes

- `stoa-ctl` is **disabled by default**. Previous users of `stoa-ctl` must enable it in Settings → Advanced after upgrading.
- `meta-session-command-env.ts` removed (zero call sites — dead code cleanup).

### Other Changes

- `ProjectSessionManager` now emits `settings:updated` event on setting changes
- Fluent 2 design language adoption for renderer components
- stoa-ctl subsession control completion

## Installation

- **NSIS Installer**: `Stoa-Setup-0.3.1-win-x64.exe`
- **Portable**: `Stoa-Portable-0.3.1-win-x64.exe`
