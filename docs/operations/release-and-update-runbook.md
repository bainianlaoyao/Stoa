# Windows Release And Update Runbook

## Scope

This runbook covers the Windows-only release flow for `stoa`.

- `main` pushes run cloud verification only.
- `v*` tags publish the formal GitHub Release.
- The formal end-user artifact is the NSIS installer.
- In-app updates stay user-confirmed. The app does not silently download or install updates.

## Release Inputs

- `package.json.version` is the only release version source of truth.
- Tags must match `v<package.json.version>` exactly.
- Formal release publication happens only from `.github/workflows/release.yml`.
- Local `pnpm run package` is for validation only. It does not publish a GitHub Release.

## Local Preflight

Run this before cutting a tag:

```bash
pnpm run test:generate
pnpm run typecheck
pnpm vitest run
pnpm run test:e2e
pnpm run test:behavior-coverage
pnpm run build
pnpm run package
pnpm run verify:packaging
pnpm run verify:release-smoke
```

`pnpm run verify:release-smoke` launches the packaged `Stoa.exe`, creates a shell session through the packaged runtime path, sends a marker command, verifies terminal replay, and exits.

## Cut A Release

1. Update `package.json.version`.
2. Run the local preflight commands.
3. Commit the version bump and release changes to `main`.
4. Create tag `vX.Y.Z`.
5. Push the branch and tag.

Example:

```bash
git tag v0.1.0
git push origin main --follow-tags
```

## GitHub Workflow Behavior

### `ci.yml`

Runs on pull requests and `main` pushes.

It must pass:

- `pnpm run test:generate`
- `pnpm run typecheck`
- `pnpm vitest run`
- `pnpm run test:e2e`
- `pnpm run test:behavior-coverage`
- `pnpm run build`
- `pnpm run package`
- `pnpm run verify:packaging`
- `pnpm run verify:release-smoke`

### `release.yml`

Runs only on `v*` tags.

It:

- rejects tag and `package.json.version` mismatches
- reruns the full verification gate
- builds the NSIS installer
- publishes a non-draft GitHub Release through `electron-builder`

Required runtime variables:

- `GH_OWNER`
- `GH_REPO`
- `GITHUB_TOKEN`

`releaseType: release` is configured in `electron-builder.yml`, so updater-visible releases are published as standard releases, not drafts.

## Expected Release Artifacts

Each formal Windows release should contain:

- `Stoa Setup X.Y.Z.exe`
- `Stoa Setup X.Y.Z.exe.blockmap`
- `latest.yml`

The local packaging baseline also keeps `release/win-unpacked/Stoa.exe` for smoke validation.

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
