# Stoa v0.3.2

## Bug Fix

### stoa-ctl bootstrap prompt no longer injected when disabled

When `stoa-ctl` was disabled in Settings → Advanced, the bootstrap prompt containing all session commands and protocol instructions was still unconditionally injected into every `SessionStart` event. This meant AI agents received `stoa-ctl` usage instructions even though the feature was turned off.

The existing 4-point gate correctly controlled shims, PATH, env vars, and HTTP endpoints — but the **bootstrap prompt injection** surface was missed during the original toggle implementation.

**Fix**: `SessionEventBridge` now checks `stoaCtlGate.isEnabled()` before fetching and injecting the bootstrap prompt. When disabled, no stoa-ctl instructions are sent to sessions.

## Installation

- **NSIS Installer**: `Stoa-Setup-0.3.2-win-x64.exe`
- **Portable**: `Stoa-Portable-0.3.2-win-x64.exe`
