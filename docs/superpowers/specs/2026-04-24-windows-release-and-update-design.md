# Windows Release And Update Design

Date: 2026-04-24
Status: Accepted direction, ready for implementation planning
Owner: Codex

## Goal

Define a Windows-only release and update architecture for `stoa` that:

- builds installable releases automatically in GitHub Actions
- publishes formal GitHub Releases only from version tags
- lets the installed app detect updates and ask the user before installing
- protects user state during upgrades by keeping program files and user data strictly separated
- treats storage safety and release automation as one delivery scope, not two unrelated tasks

This design intentionally prefers breaking changes over compatibility layers. Unknown or obsolete persisted schemas are not migrated in place.

## Current State

The current repository already has the core pieces needed to graduate into a releasable Windows desktop app, but the release chain is incomplete:

- `electron-builder.yml` only targets `portable`
- there is no configured publish provider
- there is no `electron-updater` integration in the main process
- there is no renderer-facing update UX
- `src/core/state-store.ts` performs direct overwrite writes instead of atomic replacement
- project session persistence in `<project>/.stoa/sessions.json` currently has no top-level schema version field
- About UI currently hardcodes the app version in `src/renderer/components/settings/AboutSettings.vue`

The existing persistence boundary is already favorable for safe upgrades:

- global application state lives in `~/.stoa/global.json`
- project session state lives beside the project in `<project>/.stoa/sessions.json`

Because user state already lives outside the install directory, the right release design is to preserve that separation and harden it.

## Design Principles

1. Formal releases come only from tags, never from ordinary pushes.
2. Auto-update must use the Windows packaging target that Electron tooling supports natively.
3. Update behavior must remain user-controlled during prototype stage.
4. User data safety is part of the update feature, not a follow-up enhancement.
5. Storage schema changes remain breaking changes; unsupported state is backed up and rejected, not migrated silently.
6. Release automation must be reproducible from CI only.

## Recommended Architecture

The recommended architecture is:

`versioned source -> CI verification on main -> tagged release workflow -> GitHub Release assets -> installed app checks GitHub for updates -> user confirms download/install -> app restarts into new version`

The design is intentionally split into two independent tracks:

1. `Main branch verification track`
   Ensures every change that lands on `main` still passes the repository quality gate and still produces buildable Windows artifacts.

2. `Tagged release track`
   Converts an already-verified code state into a formal GitHub Release with update metadata and installable assets.

This split prevents accidental production releases from ordinary pushes while still keeping the main branch continuously releasable.

## Versioning And Release Discipline

`package.json.version` is the single source of truth for the app version.

Formal release tags use this exact format:

- `v0.1.0`
- `v0.2.3`

Release rules:

- `main` pushes do not create formal GitHub Releases
- only `push` events for tags matching `v*` trigger release publication
- the release workflow must fail immediately if the pushed tag does not exactly match `v${package.json.version}`
- release titles, installer filenames, in-app version display, and updater metadata must all derive from the same version

Out of scope for this design:

- beta channels
- nightly channels
- prerelease update tracks
- automatic rollback to older versions

Those can be added later if needed, but they should not complicate the first release path.

## Windows Packaging Strategy

The release packaging target moves from `portable` to `nsis`.

Reasoning:

- Electron Builder's Windows auto-update path is designed around NSIS installers
- a portable executable cannot provide the same in-app install-and-restart flow
- shipping both portable and NSIS as equal formal channels would create inconsistent update behavior across users

Decision:

- `NSIS` is the only formal release artifact for end users
- `portable` may remain available only as an internal debugging artifact, but it is excluded from the formal release/update contract
- if `portable` is retained internally, the app must not imply that it supports in-app updating

`electron-builder.yml` must be updated to:

- declare a Windows `nsis` target
- configure GitHub as the publish provider
- emit the metadata required by `electron-updater` for GitHub-backed updates

## GitHub Actions Architecture

Two workflows are required.

### Workflow 1: `ci.yml`

Trigger:

- pull requests
- pushes to `main`

Responsibilities:

- enable Corepack and use the repository-pinned `pnpm` toolchain
- install dependencies with frozen lockfile semantics
- run `npm run test:generate`
- run `npm run typecheck`
- run `npx vitest run`
- run `npm run test:e2e`
- run `npm run test:behavior-coverage`
- run `npm run build`
- run a packaging smoke verification for Windows artifacts

Purpose:

- enforce the repository quality gate in the cloud
- keep `main` continuously releasable
- detect packaging regressions before a version tag is cut

### Workflow 2: `release.yml`

Trigger:

- pushes of tags matching `v*`

Runtime:

- `windows-latest`

Responsibilities:

- validate tag/version consistency
- enable Corepack and use the repository-pinned `pnpm` toolchain
- install dependencies with frozen lockfile semantics
- rerun the full repository quality gate
- build the Windows NSIS installer
- publish GitHub Release assets
- upload update metadata assets such as `latest.yml` and related files required by the updater

Authentication:

- use `GITHUB_TOKEN`
- do not require code signing secrets in the first iteration

Release publication rules:

- the workflow is the only supported path for formal release asset publication
- developers do not hand-upload installer files for formal releases
- a failed quality gate means no release is published
- the release workflow must create a published, non-draft GitHub Release discoverable by the updater
- `electron-builder` configuration or equivalent release publication logic must set the GitHub release type accordingly

Package-manager rule:

- workflows must honor `package.json.packageManager` and `pnpm-lock.yaml`
- release automation does not use floating npm install behavior
- reproducible installs are a release requirement, not an optimization

## Update Runtime Architecture

The update client lives in the Electron main process.

Introduce a dedicated `UpdateService` responsible for:

- initializing updater configuration
- checking for available updates
- exposing current updater state
- downloading a discovered update
- surfacing download progress
- finalizing install through `quitAndInstall`
- recording update diagnostics

This service should be created after `app.whenReady()` and after primary application services are initialized. Update checks should be slightly delayed so the app can finish window bootstrap and state recovery first.

Updater configuration rules:

- automatic download is disabled by default
- update download starts only after the user explicitly confirms
- the service uses explicit `downloadUpdate()` semantics rather than relying on implicit updater defaults

Recommended behavior:

- perform an automatic check shortly after startup
- expose a manual `Check for updates` action from the settings surface
- when an update is found, do not download silently without user consent
- when a download completes, wait for explicit confirmation before restart/install

This matches the chosen user experience: polite prompt, explicit confirmation, no silent takeover.

Development and test behavior:

- when `app.isPackaged` is `false`, update checks are disabled by default
- unpackaged development and Playwright E2E runs must not depend on live updater traffic
- if future unpackaged updater testing is required, it must use an explicit development update configuration rather than piggyback on normal E2E runs

## Session-Safe Install Behavior

This repository runs live PTY-backed shell sessions and recovers non-archived sessions on startup. That means update install can interrupt active runtime state even if persisted files are protected.

Therefore update UX must include a session-safety contract:

- before `quitAndInstall`, the app checks whether any non-archived session is still active, restorable, or running
- if live sessions exist, the install confirmation explicitly warns that the app will terminate local shells and interrupt active session runtime
- the default action in this warning state is `Later`, not immediate install
- the user must perform a second explicit confirmation before install proceeds while sessions are active
- no background silent install is allowed

This keeps file safety and runtime safety separate and visible.

## IPC Surface For Updates

Renderer code must not call updater APIs directly. The main process exposes a narrow update bridge over IPC.

Recommended channels:

- `update.getState`
- `update.checkForUpdates`
- `update.downloadUpdate`
- `update.quitAndInstall`
- `update.dismiss`

The preload contract must expose only the typed operations needed by renderer surfaces. Main, preload, shared types, and tests must evolve together under the existing repository IPC guard patterns.

## Renderer UX

The update UX should be intentionally restrained and aligned with the existing Modern Minimalist Glassmorphism direction.

Primary surface:

- extend the existing About settings panel to show:
  - current app version
  - update status
  - latest check result
  - a manual `Check for updates` action

Secondary surface:

- when an update is detected, show a lightweight in-app dialog or overlay
- actions:
  - `Later`
  - `Download and update`

Post-download confirmation:

- when the update payload is ready, show:
  - `Later`
  - `Restart and install`

UX constraints:

- reuse existing design tokens
- version strings remain mono-typed
- status badges, progress, and actions use existing tokenized surface and text hierarchy
- avoid system-native blocking dialog spam unless the app cannot proceed

This keeps update handling discoverable without disrupting session-oriented workflows.

## Data Safety And Persistence Hardening

Enabling updates without storage hardening would create an avoidable data-loss perception risk. The persistence layer must be upgraded as part of the same implementation scope.

### 1. Atomic writes

Global and project session state writes must switch from direct overwrite to atomic replacement:

- write complete JSON to a temporary file in the same directory
- flush and close the temporary file
- rename it over the destination file

This reduces the chance of partial writes during crashes or power loss.

### 2. Corruption isolation

If a persisted state file is unreadable or invalid:

- do not silently discard it
- rename it to a timestamped corruption backup
- log the recovery action
- continue with a fresh default file only after preserving the bad artifact

The app should surface a readable user-facing message that a corrupted state file was isolated and replaced.

### 3. Unsupported schema handling

The repository explicitly rejects compatibility migrations during prototype stage. Therefore:

- if persisted data has an unknown schema version, the app does not attempt migration
- the unsupported file is backed up
- the failure is logged explicitly
- the user receives a clear message that the previous state is incompatible with this build

This is a deliberate breaking-change contract, not an implementation omission.

Because project session persistence currently lacks a top-level version field, this design also requires a schema boundary change for `<project>/.stoa/sessions.json`:

- project session files gain an explicit top-level schema version
- legacy unversioned project session files are treated as unsupported persisted state
- unsupported legacy files are backed up before reset
- no migration path is provided

Without this change, the design could only enforce unsupported-schema rejection for `global.json`, which would leave project session state outside the safety contract.

### 4. Install boundary

User state, logs, and recovery artifacts must remain outside the install directory. The installer may replace application binaries, but it must never own user state files.

### 5. Multi-file consistency

This repository persists state across more than one file, so per-file atomic replacement is not enough by itself.

The persistence contract must also define cross-file consistency rules:

- project session files are written before `global.json`
- `global.json` is treated as the final commit marker for active-project and active-session references
- on bootstrap, active references are validated against the loaded session set
- dangling `active_project_id` or `active_session_id` values are cleared rather than trusted
- orphaned or unsupported project-session files are ignored or isolated according to the schema rules above

This prevents crashes or update-triggered restarts from leaving the app in a logically inconsistent state even when each individual file write is atomic.

## Logging And Diagnostics

The update path needs explicit observability.

Recommended additions:

- a dedicated update log file under `~/.stoa/logs/`
- structured log events for:
  - update checks
  - discovered versions
  - download start
  - download progress milestones
  - download completion
  - install trigger
  - failures and error messages

Renderer-visible diagnostics should stay minimal:

- current version
- updater state summary
- last check timestamp
- latest error summary when relevant

This is enough to support first-line troubleshooting without building a heavy diagnostics console.

## Testing Strategy

Release and update work must satisfy the repository quality gate and add coverage where the new behavior lives.

### Unit tests

Add focused tests for:

- update service state transitions
- updater event handling
- tag/version validation logic
- atomic write and corruption-backup behavior in `state-store`
- unsupported schema handling

### Component tests

Add renderer tests for:

- About settings version and update status display
- update prompt interaction
- post-download restart/install prompt

### Integration and E2E tests

Add integration coverage for:

- preload/main/renderer update bridge behavior
- a fake updater flow that simulates:
  - no update
  - update available
  - download progress
  - download completion
  - install request
- storage corruption and backup behavior
- unsupported version rejection behavior

### CI artifact verification

Add or extend packaging verification so CI confirms the release build emits the expected Windows updater artifacts, not only base Electron outputs.

The current `scripts/verify-packaging-baseline.mjs` only validates build outputs under `out/`. This design requires a release-artifact verification step that explicitly asserts the presence of Windows updater artifacts in the release output, including:

- the NSIS installer
- `latest.yml`
- updater blockmap artifacts when emitted
- any other updater metadata required by the chosen Electron updater path

Green CI without these artifact assertions is not considered sufficient.

In addition, because this repository treats packaged `node-pty` runtime as a high-risk area, release verification must include at least one Windows packaged smoke path that:

- launches the packaged app
- confirms the app boots successfully
- creates or restores a session through the packaged runtime path
- verifies PTY input/output still works in the packaged build

Artifact presence alone is not enough to declare the formal release channel healthy.

## Documentation Requirements

Implementation must also add an operator-facing runbook under `docs/operations/`.

It should cover:

- how formal releases are cut
- how version/tag matching works
- where installer and updater assets appear
- where update logs live
- what to do when update checks fail
- what to do when persisted state is corrupt or unsupported

This turns release/update from tribal knowledge into an explicit operational contract.

## File And Responsibility Outline

Expected implementation areas:

- `electron-builder.yml`
  - switch formal Windows packaging to NSIS and configure GitHub publishing
- `.github/workflows/ci.yml`
  - add or align cloud verification workflow with repository quality gate and pinned `pnpm` install behavior
- `.github/workflows/release.yml`
  - add tagged formal release workflow with pinned `pnpm` install behavior
- `src/main/`
  - add update service, session-aware install warnings, and wire them into app lifecycle
- `src/preload/index.ts`
  - expose typed update API to renderer
- `src/shared/`
  - add update-state contracts shared by main/preload/renderer
- `src/shared/project-session.ts`
  - add explicit schema versioning for project session persistence
- `src/renderer/components/settings/AboutSettings.vue`
  - replace hardcoded version and add update status/actions
- `src/renderer/components/`
  - add prompt surface for update discovery and install confirmation if the existing settings surface is not sufficient
- `src/core/state-store.ts`
  - implement atomic writes, corruption backup, and unsupported schema handling
- `docs/operations/`
  - add release/update runbook

## Rollout Sequence

Recommended implementation order:

1. Harden persistence and backup behavior.
2. Switch packaging to NSIS and verify local packaging output.
3. Add main-process update service plus IPC contract.
4. Add renderer update UX in settings and prompt surfaces.
5. Add tests across unit, component, integration, and packaging verification layers.
6. Add GitHub Actions release automation.

This order prevents a situation where release automation is live before the app is safe to upgrade.

## Risks And Non-Goals

Known risks:

- unsigned Windows installers will still produce SmartScreen friction
- GitHub Release propagation latency may briefly delay update visibility
- updater behavior is sensitive to artifact naming and metadata correctness, so packaging verification must be explicit

Non-goals:

- macOS or Linux release design
- code signing rollout
- delta-channel strategy beyond the updater defaults
- compatibility migrations for prior persisted schemas
- portable build support as a formal update-capable channel

## Acceptance Criteria

This design is satisfied when all of the following are true:

- a push to `main` runs the repository quality gate in GitHub Actions and validates Windows buildability
- a push of `vX.Y.Z` creates a Windows GitHub Release from CI only
- the release contains the installer and updater metadata required by the Windows updater
- an installed app can detect a newer GitHub Release and present an in-app confirmation flow
- the app downloads the update only after user confirmation
- the app installs the update only after user confirmation to restart
- if active sessions exist, the install confirmation explicitly warns about session interruption before proceeding
- upgrading the app does not overwrite user data files
- corrupted persisted state is backed up before reset
- unsupported persisted schema versions are backed up and rejected explicitly rather than migrated silently
- release workflows use the repository-pinned `pnpm` toolchain with frozen lockfile behavior
- packaging verification asserts Windows updater artifacts rather than only raw build outputs
