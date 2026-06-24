# Stoa v0.3.6

## Summary

This release candidate updates Stoa around the current Stoa Server, web runtime, runtime bridge, and mobile UI code line.

The main user-facing change is that Stoa is no longer described only as a desktop terminal console. Electron still owns the native PTY runtime, but the embedded Stoa Server now provides the REST/WebSocket control plane, web renderer path, and runtime bridge that future desktop, browser, and mobile pickup flows share.

## Highlights

- **Mobile UI v1 shell**: phone portrait and phone landscape viewports get a dedicated workspace/session drilldown, session search, fixed wide xterm surface, horizontal scrolling, key rail, and backend health lockout.
- **Stoa Server + web runtime path**: the package builds the web renderer, serves it from Stoa Server, uses token-protected REST/WebSocket access, and routes terminal input/output through the Electron runtime bridge.
- **Runtime bridge hardening**: launch, restore, restart, provider disconnect, runtime alive/exited state sync, launch timeout, queued input, queued resize, and terminal replay paths were tightened.
- **Terminal interaction fixes**: Ctrl+C copies active terminal selection before falling back to interrupt behavior, and interrupts are reflected through structured agent-turn state.
- **Quality gate update**: `npm run test:all` now includes `npm run typecheck`.

## Breaking / Upgrade Notes

- Stoa is still in prototype-stage development. Breaking changes remain allowed, and unsupported persisted schemas are rejected instead of migrated.
- Windows remains the formal release target for this build. macOS and Linux targets are configured but should not be published as official artifacts without platform-specific signing and smoke verification.
- The already-published `v0.3.5` GitHub Release points at older sidebar-scroll fixes. Publish this release as a new `v0.3.6` tag/artifact set instead of editing the old tag.

## Installation Artifacts

- **NSIS Installer**: `Stoa-Setup-0.3.6-win-x64.exe`
- **Portable**: `Stoa-Portable-0.3.6-win-x64.exe`
- **Update metadata**: `latest.yml`
- **Delta blockmap**: `Stoa-Setup-0.3.6-win-x64.exe.blockmap`

## Verification

Run the full repository quality gate before tagging and uploading artifacts:

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

Then package and smoke-test the Windows artifacts:

```bash
pnpm run build
pnpm run build:stoa-server
pnpm run package
pnpm run verify:packaging
pnpm run verify:release-smoke
```
