---
date: 2026-06-06
topic: electron-release-and-build-process
status: completed
mode: context-gathering
sources: 8
---

## Context Report: Electron Release and Build Process

### Why This Was Gathered
To understand the complete release and build pipeline for the Stoa Electron app, including version management, build configuration, platform support, and release automation.

### Summary
Stoa uses a **local-first release workflow** with GitHub as the distribution platform. The current version is **0.3.3**. Building is handled by **electron-builder 26.0.12** via electron-vite, with platform-specific packaging for Windows (NSIS + portable), macOS (DMG + ZIP), and Linux (AppImage + deb). The authoritative release process is **local build + manual GitHub upload**, with a deprecated GitHub Actions workflow kept only as emergency fallback.

## Key Findings

### 1. Current Version and Package Structure

**File**: `D:\Data\DEV\ultra_simple_panel\package.json` (lines 1-38)

```json
{
  "name": "stoa",
  "version": "0.3.3",
  "main": "out/main/index.cjs",
  "type": "module",
  "packageManager": "pnpm@10.33.0"
}
```

**Key Dependencies**:
- `electron: ^37.4.0`
- `electron-builder: ^26.0.12`
- `electron-vite: ^4.0.0`
- `electron-updater: ^6.8.3`

### 2. Build Process (npm scripts)

**File**: `D:\Data\DEV\ultra_simple_panel\package.json` (lines 9-37)

**Core Build Scripts**:
- `build` → `electron-vite build && node scripts/build-stoa-ctl.mjs` (line 11)
- `package` → `node scripts/run-electron-builder.mjs` (line 18)
- `package:local` → Build + Package (line 22)
- `package:release` → Build + Package with publish (line 23)

**Platform-Specific Packaging**:
- `package:win` → `pnpm run build && node scripts/run-electron-builder.mjs --win` (line 19)
- `package:mac` → `pnpm run build && node scripts/run-electron-builder.mjs --mac` (line 20)
- `package:linux` → `pnpm run build && node scripts/run-electron-builder.mjs --linux` (line 21)

**Verification Scripts**:
- `verify:packaging` → Validates artifact structure (line 28)
- `verify:release-smoke` → Integration tests packaged app (line 29)

**Quality Gate Script**:
- `ci:local` → Full test suite + build + package + verify (line 37)

### 3. electron-builder Configuration

**File**: `D:\Data\DEV\ultra_simple_panel\electron-builder.yml` (lines 1-60)

**App Identity**:
```yaml
appId: dev.stoa.app
productName: Stoa
directories:
  output: release
```

**Publishing Configuration**:
```yaml
publish:
  provider: github
  owner: "${env.GH_OWNER}"      # Default: "local-dev"
  repo: "${env.GH_REPO}"         # Default: "stoa-local"
  releaseType: release
```

**Platform Configuration**:

**Windows** (lines 29-35):
```yaml
win:
  icon: build/icons/icon.ico
  target:
    - nsis                       # NSIS installer
    - target: portable           # Portable executable
      arch:
        - x64
```

**NSIS Installer** (lines 21-27):
```yaml
nsis:
  artifactName: "${productName}-Setup-${version}-${os}-${arch}.${ext}"
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
```

**Portable** (lines 27-28):
```yaml
portable:
  artifactName: "${productName}-Portable-${version}-${os}-${arch}.${ext}"
```

**macOS** (lines 36-47):
```yaml
mac:
  icon: build/icons/icon.icns
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch:
        - x64
        - arm64
    - target: zip
      arch:
        - x64
        - arm64
```

**Linux** (lines 48-57):
```yaml
linux:
  icon: build/icons/icon.png
  category: Development
  target:
    - target: AppImage
      arch:
        - x64
    - target: deb
      arch:
        - x64
```

**Resource Handling** (lines 6-14):
```yaml
files:
  - out/**
  - package.json
extraResources:
  - from: research/upstreams/evolver
    to: evolver
asarUnpack:
  - node_modules/node-pty/**
  - out/tools/entire-bridge/**
  - out/tools/stoa-ctl/**
```

### 4. Release Automation

**GitHub Actions Workflow** (DEPRECATED):
**File**: `D:\Data\DEV\ultra_simple_panel\.github\workflows\release.yml` (lines 1-78)

- **Status**: Deprecated - kept only as emergency fallback
- **Trigger**: Manual workflow_dispatch only
- **Platform**: Windows-only (windows-latest)
- **Environment variables**: `GH_OWNER`, `GH_REPO` from GitHub context
- **Steps**: Full test suite → Build → Package → Publish to GitHub

**CI Workflow**:
**File**: `D:\Data\DEV\ultra_simple_panel\.github\workflows\ci.yml` (lines 1-65)

- **Triggers**: Pull requests, pushes to main
- **Platform**: Windows-only
- **Artifacts**: Uploads Windows installer as GitHub Actions artifact

### 5. Authoritative Release Process (Local-First)

**File**: `D:\Data\DEV\ultra_simple_panel\docs\operations\release-and-update-runbook.md` (lines 1-194)

**Release Philosophy**:
- **Local build + manual GitHub upload** is the authoritative process
- GitHub Actions workflow is deprecated and NOT for production use
- User-confirmed updates only (no silent updates)

**Step-by-Step Procedure** (simplified):
1. Edit `package.json` version
2. Commit version bump
3. Run quality gate (`test:generate`, `typecheck`, `vitest`, `test:e2e`, `test:behavior-coverage`)
4. Create and push git tag matching version (e.g., `v0.3.3`)
5. Create GitHub release with notes
6. Build and package locally with `GH_OWNER` and `GH_REPO` environment variables
7. Upload artifacts to GitHub release
8. Optional smoke test

**Release Artifacts** (from runbook lines 81-88):
- `Stoa-Setup-X.Y.Z-win-x64.exe` - NSIS installer
- `Stoa-Setup-X.Y.Z-win-x64.exe.blockmap` - Delta update blockmap
- `Stoa-Portable-X.Y.Z-win-x64.exe` - Portable executable
- `latest.yml` - Auto-update metadata

### 6. Build Scripts

**Main Build Runner**:
**File**: `D:\Data\DEV\ultra_simple_panel\scripts\run-electron-builder.mjs` (lines 1-19)

```javascript
const cli = require.resolve('electron-builder/out/cli/cli.js')
const args = ['--config', 'electron-builder.yml', ...process.argv.slice(2)]
const env = {
  ...process.env,
  GH_OWNER: process.env.GH_OWNER || 'local-dev',
  GH_REPO: process.env.GH_REPO || 'stoa-local'
}
// Spawns electron-builder with config and environment
```

**Packaging Artifact Utilities**:
**File**: `D:\Data\DEV\ultra_simple_panel\scripts\packaging-artifacts.mjs` (lines 1-244)

Key functions:
- `normalizePlatform()` - Platform alias resolution
- `resolveReleaseMetadataName()` - Returns `latest.yml` (win), `latest-mac.yml` (mac), `latest-linux.yml` (linux)
- `resolvePackagedExecutable()` - Finds packaged executable in unpacked directory
- `verifyPackagingBaseline()` - Validates artifacts, metadata, and blockmap files

**Smoke Test Script**:
**File**: `D:\Data\DEV\ultra_simple_panel\scripts\smoke-packaged-release.mjs` (lines 1-204)

- Launches packaged `.exe`
- Creates test project directory
- Sends terminal marker command
- Verifies terminal replay and Claude session hooks
- Runs on Windows, macOS, and Linux

### 7. Release Notes

**Files Found**:
- `release-notes-0.2.0.md`
- `release-notes-0.2.1.md`
- `release-notes-0.2.2.md`
- `release-notes-v0.3.1.md`
- `release-notes-v0.3.2.md`

**Example Structure** (from `release-notes-v0.3.2.md`):
```markdown
# Stoa v0.3.2

## Bug Fix
### stoa-ctl bootstrap prompt no longer injected when disabled

## Installation
- **NSIS Installer**: `Stoa-Setup-0.3.2-win-x64.exe`
- **Portable**: `Stoa-Portable-0.3.2-win-x64.exe`
```

### 8. Platform Support Summary

| Platform | Architectures | Artifacts | Status |
|----------|--------------|-----------|--------|
| **Windows** | x64 | NSIS installer, Portable exe | Fully supported |
| **macOS** | x64, arm64 | DMG, ZIP | Fully supported |
| **Linux** | x64 | AppImage, deb | Fully supported |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Current version 0.3.3 | package.json | line 3 |
| electron-builder 26.0.12 | package.json | line 68 |
| Build script: electron-vite + stoa-ctl | package.json | line 11 |
| Package script invokes run-electron-builder.mjs | package.json | line 18 |
| Platform-specific package scripts | package.json | lines 19-21 |
| electron-builder.yml configuration | electron-builder.yml | lines 1-60 |
| Windows NSIS + portable targets | electron-builder.yml | lines 21-35 |
| macOS DMG + ZIP targets | electron-builder.yml | lines 36-47 |
| Linux AppImage + deb targets | electron-builder.yml | lines 48-57 |
| GitHub provider with env vars | electron-builder.yml | lines 16-20 |
| Deprecated GitHub Actions release | .github/workflows/release.yml | lines 1-78 |
| Local-first release process | docs/operations/release-and-update-runbook.md | lines 1-194 |
| Release artifacts list | docs/operations/release-and-update-runbook.md | lines 81-88 |
| Build runner script | scripts/run-electron-builder.mjs | lines 1-19 |
| Packaging verification utilities | scripts/packaging-artifacts.mjs | lines 1-244 |
| Smoke test script | scripts/smoke-packaged-release.mjs | lines 1-204 |
| Platform alias resolution | scripts/packaging-artifacts.mjs | lines 4-27 |
| Metadata file naming | scripts/packaging-artifacts.mjs | lines 36-41 |

### Risks / Unknowns

- [!] **Windows code signing not enabled** - SmartScreen warnings expected for downloaded executables
- [?] **macOS code signing status** - Not mentioned in docs; may cause Gatekeeper issues
- [?] **Linux packaging test coverage** - macOS and Linux builds configured but Windows-only testing documented
- [!] **Deprecated GitHub Actions workflow** - Lines 3-6 in release.yml explicitly deprecate it, but it still exists and could be triggered accidentally
- [?] **Auto-update mechanism** - electron-updater configured but update flow documentation suggests manual verification is recommended
- [?] **Release notes automation** - Individual markdown files exist but no generation automation found