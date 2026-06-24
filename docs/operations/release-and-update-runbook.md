# Windows Release And Update Runbook

## Scope

This runbook covers the Windows release flow for Stoa.

- **Releases are cut locally and uploaded manually.** This is the authoritative release path — the only process used for production releases.
- The formal end-user artifacts are the NSIS installer and the portable executable.
- In-app updates stay user-confirmed. The app does not silently download or install updates.
- The `.github/workflows/release.yml` workflow is **deprecated** and kept only as an emergency fallback. Do not use it for routine releases.

## Release Inputs

- `package.json` `version` is the only release version source of truth.
- Tags must match `v<package.json.version>` exactly (e.g. version `0.1.1` → tag `v0.1.1`).
- `electron-builder.yml` `electronVersion` is the Electron runtime version used by release packaging.
- `pnpm run package` rebuilds native modules against the configured Electron runtime before invoking electron-builder.

## Full Release Procedure

### Step 1 — Bump Version

Edit `package.json` on `main`:

```json
{ "version": "X.Y.Z" }
```

Commit:

```bash
git add package.json
git commit -m "chore: bump version to X.Y.Z"
```

### Step 2 — Local Preflight

Run the quality gate before tagging:

```bash
pnpm run test:generate
pnpm run typecheck
pnpm vitest run
pnpm run test:e2e
pnpm run test:behavior-coverage
```

### Step 3 — Tag and Push

```bash
git tag vX.Y.Z
git push origin main --tags
```

This pushes both the version bump commit and the tag to remote.

### Step 4 — Create GitHub Release (Draft Notes First)

Write release notes to a temp file, then create the release:

```powershell
# Write notes (or prepare them in advance)
gh release create vX.Y.Z --title "Stoa vX.Y.Z" --notes-file release-notes.md
```

The release is now published on GitHub with tag `vX.Y.Z` but has no artifacts yet.

### Step 5 — Build and Package

```bash
# Ensure deps are installed
pnpm install

# Build desktop and Stoa Server assets
pnpm run build
pnpm run build:stoa-server

# Package (native rebuild + NSIS installer + portable exe)
$env:GH_OWNER = "bainianlaoyao"
$env:GH_REPO   = "Stoa"
pnpm run package
```

Output goes to `release/`:

| Artifact | Description |
| --- | --- |
| `Stoa-Setup-X.Y.Z-win-x64.exe` | NSIS installer |
| `Stoa-Setup-X.Y.Z-win-x64.exe.blockmap` | Delta update blockmap |
| `Stoa-Portable-X.Y.Z-win-x64.exe` | Portable (no-install) executable |
| `latest.yml` | Auto-update metadata |

### Step 6 — Upload Artifacts

```powershell
gh release upload vX.Y.Z `
  "release/Stoa-Setup-X.Y.Z-win-x64.exe" `
  "release/Stoa-Setup-X.Y.Z-win-x64.exe.blockmap" `
  "release/Stoa-Portable-X.Y.Z-win-x64.exe" `
  "release/latest.yml"
```

### Step 7 — Smoke Test

Verify the packaged build before upload or announcement:

```bash
pnpm run verify:packaging
pnpm run verify:release-smoke
```

`pnpm run verify:release-smoke` launches the packaged `Stoa.exe`, creates a shell session through the packaged runtime path, sends a marker command, verifies terminal replay, and exits.

### Step 8 — Announce

The release is now live at:
`https://github.com/bainianlaoyao/Stoa/releases/tag/vX.Y.Z`

## One-Shot Checklist

```
1. Edit package.json version on main
2. git commit -m "chore: bump version to X.Y.Z"
3. Run quality gate (test:generate, typecheck, vitest, test:e2e, behavior-coverage)
4. git tag vX.Y.Z
5. git push origin main --tags
6. gh release create vX.Y.Z --title "Stoa vX.Y.Z" --notes-file notes.md
7. pnpm install && pnpm run build && pnpm run build:stoa-server
8. $env:GH_OWNER="bainianlaoyao"; $env:GH_REPO="Stoa"; pnpm run package
9. pnpm run verify:packaging && pnpm run verify:release-smoke
10. gh release upload vX.Y.Z release/Stoa-Setup-X.Y.Z-win-x64.exe ...
```

## Installed App Update Flow

The installed app behaves like this:

1. Main process checks for updates in packaged builds only.
2. Renderer surfaces status in About.
3. User chooses whether to download.
4. User chooses whether to restart and install.
5. If active sessions exist, the app shows a second warning before install.

This is intentionally not a silent-update flow.

## Data Safety Boundaries

The installer replaces app binaries only. User data stays outside the install directory.

Current persisted state locations:

- Global app state: `~/.stoa/global.json`
- App log: `~/.stoa/logs/app.log`
- Update log: `~/.stoa/logs/update.log`
- Project session state: `<project>/.stoa/sessions.json`
- Corruption and unsupported-schema backups: sibling `.stoa/backups/`

Prototype-stage rule:

- unsupported persisted schemas are backed up and rejected
- no compatibility migration is attempted

## Recovery Procedure

If the app resets state after an upgrade or launch:

1. Check `~/.stoa/global.json`.
2. Check `<project>/.stoa/sessions.json`.
3. Inspect `.stoa/backups/` for `corrupt` or `unsupported` snapshots.
4. Inspect `~/.stoa/logs/app.log` for startup and runtime context.
5. Inspect `~/.stoa/logs/update.log` for updater state transitions and install decisions.

Typical causes:

- invalid JSON on disk
- unsupported schema version
- dangling active project or session references after interrupted writes

The current implementation repairs dangling active references on bootstrap instead of trusting them.

## Update Failure Triage

If users report update problems:

1. Confirm the GitHub Release exists and is not a draft.
2. Confirm the release contains `latest.yml` and the NSIS installer assets.
3. Confirm the installed app version shown in About is older than the tag being published.
4. Confirm the app is a packaged install, not an unpackaged dev run.
5. Check `~/.stoa/logs/update.log`.
6. Check `~/.stoa/logs/app.log` and the About status message for surrounding context.

## Known Operational Limits

- Windows signing is not enabled yet, so SmartScreen friction is expected.
- Release publication assumes GitHub-hosted metadata via `latest.yml`.
- Prototype releases are allowed to break old persisted schemas by design.
