---
date: 2026-06-05
topic: electron-build-and-packaging-configuration
status: completed
mode: context-gathering
sources: 15
---

## Context Report: Electron Build and Packaging Configuration

### Why This Was Gathered
To provide comprehensive context for implementing or modifying Electron build, packaging, and auto-update functionality in the Stoa application.

### Summary

**Stoa** is an Electron application (v37.4.0) using **electron-builder** (v26.0.12) as its build tool with **electron-updater** (v6.8.3) for auto-update functionality. The project has a complete Windows release and update implementation with NSIS installer packaging, GitHub-based publishing, and session-aware update guards. The build system targets Windows (NSIS + portable), macOS (DMG + ZIP), and Linux (AppImage + deb) distribution formats.

---

## Key Findings

### 1. Build Tool: electron-builder

**Tool:** electron-builder v26.0.12

**Configuration file:** `electron-builder.yml`

**Key configuration:**
- App ID: `dev.stoa.app`
- Product name: `Stoa`
- Output directory: `release/`
- Artifact naming: `${productName}-${version}-${os}-${arch}.${ext}`

**Distribution targets:**
- **Windows:** NSIS installer + portable executable (x64)
- **macOS:** DMG + ZIP (x64, arm64)
- **Linux:** AppImage + deb (x64)

**Special packaging features:**
- ASAR packaging enabled
- Unpacked resources: `node_modules/node-pty/**`, `out/tools/entire-bridge/**`, `out/tools/stoa-ctl/**`
- Extra resources: `research/upstreams/evolver` → `evolver`
- No npm rebuild (`npmRebuild: false`)

---

### 2. Auto-Update System: electron-updater

**Library:** electron-updater v6.8.3

**Update source:** GitHub Releases
- Provider: GitHub
- Owner: `${env.GH_OWNER}` (default: `local-dev`)
- Repo: `${env.GH_REPO}` (default: `stoa-local`)
- Release type: `release`

**Update implementation:**
- **Main process service:** `src/main/update-service.ts` (315 lines)
- **State management:** `src/shared/update-state.ts` (defines UpdateState interface)
- **Renderer store:** `src/renderer/stores/update.ts` (Pinia store)
- **UI components:** `src/renderer/components/update/UpdatePrompt.vue`

**Update flow:**
1. Automatic check on startup (delayed)
2. Manual "Check for updates" in About settings
3. User confirmation before download
4. Session warning before install (if active sessions exist)
5. User confirmation before restart/install

**Key features:**
- Auto-download disabled (`autoDownload = false`)
- Session-aware install guards
- Update logging to `~/.stoa/logs/`
- State machine with 8 phases: idle, checking, available, downloading, downloaded, up-to-date, disabled, error

---

### 3. Package.json Build Configuration

**Location:** `package.json`

**Build scripts:**
```json
{
  "dev": "electron-vite dev",
  "build": "electron-vite build && node scripts/build-stoa-ctl.mjs",
  "package": "node scripts/run-electron-builder.mjs",
  "package:win": "pnpm run build && node scripts/run-electron-builder.mjs --win",
  "package:mac": "pnpm run build && node scripts/run-electron-builder.mjs --mac",
  "package:linux": "pnpm run build && node scripts/run-electron-builder.mjs --linux",
  "package:release": "pnpm run build && node scripts/run-electron-builder.mjs --publish always"
}
```

**Build wrapper:** `scripts/run-electron-builder.mjs`
- Invokes electron-builder CLI with config file
- Sets environment variables: `GH_OWNER`, `GH_REPO`
- Defaults to `local-dev`/`stoa-local` for testing

**Quality verification:**
```json
{
  "verify:packaging": "node scripts/verify-packaging-baseline.mjs",
  "verify:release-smoke": "node scripts/smoke-packaged-release.mjs"
}
```

---

### 4. Update-Related Code Files

**Core update implementation:**

| File | Purpose | Lines |
|------|---------|-------|
| `src/main/update-service.ts` | Main-process update coordinator over electron-updater | 315 |
| `src/main/update-service.test.ts` | Unit tests for update service | 303 |
| `src/shared/update-state.ts` | UpdateState type definitions | 21 |
| `src/renderer/stores/update.ts` | Pinia store for update state | 86 |
| `src/renderer/components/update/UpdatePrompt.vue` | Update prompt UI component | N/A |
| `tests/e2e/update-bridge.test.ts` | End-to-end update integration tests | N/A |

**IPC channels:**
- `update:get-state` - Get current update state
- `update:check` - Check for updates
- `update:download` - Download available update
- `update:quit-and-install` - Install and restart
- `update:dismiss` - Dismiss update notification
- `update:state` - Push update state to renderer

**Update state phases:**
```typescript
type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'disabled'
  | 'error'
```

---

### 5. Distribution Format

**Windows:**
- **Primary:** NSIS installer (`Stoa-Setup-{version}-windows-x64.exe`)
  - One-click: false (user can change install directory)
  - Per-machine: false (user-level install)
  - Creates desktop shortcut: true
- **Secondary:** Portable (`Stoa-Portable-{version}-windows-x64.exe`)

**macOS:**
- DMG image (x64, arm64)
- ZIP archive (x64, arm64)
- Category: `public.app-category.developer-tools`

**Linux:**
- AppImage (x64)
- deb package (x64)
- Category: `Development`

---

### 6. CI/CD Pipelines

**CI Workflow:** `.github/workflows/ci.yml`
- **Triggers:** Pull requests, pushes to main
- **Platform:** windows-latest
- **Package manager:** pnpm 10.33.0 (Corepack)
- **Steps:**
  1. Install dependencies (frozen lockfile)
  2. Generate deterministic tests
  3. Typecheck
  4. Run Vitest
  5. Run E2E tests (commented out currently)
  6. Verify behavior coverage
  7. Build production bundles
  8. Package Windows artifacts (publish: never)
  9. Verify release artifacts
  10. Smoke packaged Windows build
  11. Upload Windows installer artifact

**Release Workflow:** `.github/workflows/release.yml`
- **Status:** DEPRECATED (emergency fallback only)
- **Trigger:** Manual workflow_dispatch
- **Platform:** windows-latest
- **Steps:**
  1. Tag version validation
  2. Full quality gate (tests + build)
  3. Package Windows artifacts
  4. Verify packaging
  5. Smoke packaged release
  6. Publish to GitHub (publish: always)

**Note:** According to workflow documentation, the authoritative release path is local build + manual upload per operations/runbook. The GitHub workflow is only for emergency fallback.

---

## Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Build tool is electron-builder | package.json | Lines 68 |
| electron-builder v26.0.12 | package.json | Line 68 |
| electron-updater v6.8.3 | package.json | Line 51 |
| NSIS + portable Windows targets | electron-builder.yml | Lines 31-35 |
| GitHub publishing configured | electron-builder.yml | Lines 16-20 |
| Update service implementation | src/main/update-service.ts | Lines 1-315 |
| Auto-download disabled | src/main/update-service.ts | Line 98 |
| Session-aware install guards | src/main/update-service.ts | Lines 197-204 |
| IPC channel definitions | src/core/ipc-channels.ts | (inferred) |
| Update state types | src/shared/update-state.ts | Lines 1-21 |
| Renderer update store | src/renderer/stores/update.ts | Lines 1-86 |
| CI workflow runs on windows-latest | .github/workflows/ci.yml | Line 11 |
| Release workflow deprecated | .github/workflows/release.yml | Lines 1-7 |
| Build wrapper sets GH_OWNER/GH_REPO | scripts/run-electron-builder.mjs | Lines 7-11 |
| macOS targets (DMG + ZIP) | electron-builder.yml | Lines 39-47 |
| Linux targets (AppImage + deb) | electron-builder.yml | Lines 51-57 |
| ASAR unpack rules for node-pty | electron-builder.yml | Lines 12-14 |

---

## Risks / Unknowns

### Risks:
- [!] **Deprecated release workflow** - GitHub Actions release.yml is marked as deprecated and should not be used for production releases
- [!] **No code signing** - Windows installers are unsigned, will trigger SmartScreen warnings
- [!] **Test certificate** - Release workflow uses test certificate status (check line 75)
- [!] **E2E tests commented out** - Windows E2E tests are disabled in CI (line 39 in ci.yml)

### Unknowns:
- [?] **Manual release process** - The exact manual release process referenced in workflow documentation is not detailed
- [?] **Code signing strategy** - No information about future code signing implementation
- [?] **Release artifact storage** - Where release artifacts are stored long-term
- [?] **Update server fallback** - No fallback if GitHub is unavailable

---

## Architecture Notes

### Data Flow:
1. **Build:** electron-vite compiles → electron-builder packages → NSIS installer created
2. **Publish:** Manual upload to GitHub Releases creates latest.yml + artifacts
3. **Update Check:** electron-updater queries GitHub Releases API
4. **Download:** User confirms → UpdateService downloads via electron-updater
5. **Install:** Session guard check → User confirms → quitAndInstall()

### Session Safety:
- Active sessions prevent silent install
- User must explicitly confirm install with active sessions
- PTY sessions are terminated during update
- Session state persisted outside install directory

### State Persistence:
- Global state: `~/.stoa/global.json`
- Project sessions: `<project>/.stoa/sessions.json`
- Atomic writes implemented (state-store.ts)
- Corruption backup implemented
- Unsupported schema rejection (no migration)

---

## Design Documentation References

The project has comprehensive design documentation for the release and update system:

1. **Design spec:** `docs/superpowers/specs/2026-04-24-windows-release-and-update-design.md` (510 lines)
2. **Implementation plan:** `docs/superpowers/plans/2026-04-24-windows-release-and-update.md` (1140 lines)

These documents cover:
- Architecture rationale
- Implementation tasks (7 major tasks)
- Testing strategy
- Release procedures
- Data safety guarantees
- Session-safe install behavior
- Operator runbook requirements

---

## Dependencies Matrix

| Category | Package | Version | Purpose |
|----------|---------|---------|---------|
| Build | electron-builder | 26.0.12 | Packaging and distribution |
| Update | electron-updater | 6.8.3 | Auto-update functionality |
| Runtime | electron | 37.4.0 | Application runtime |
| Build tool | electron-vite | 4.0.0 | Development build tool |
| Native deps | node-pty | 1.1.0 | PTY for terminal sessions |
| Native deps | better-sqlite3 | 12.9.0 | SQLite database |

---

## Version Information

- **Current version:** 0.3.3
- **Electron version:** 37.4.0
- **Node version (CI):** 22
- **Package manager:** pnpm 10.33.0
- **Package type:** module (ESM)

---

## File Structure Summary

```
├── electron-builder.yml              # Main build configuration
├── package.json                       # Dependencies and scripts
├── scripts/
│   ├── run-electron-builder.mjs      # Build wrapper
│   ├── verify-packaging-baseline.mjs # Artifact verification
│   └── smoke-packaged-release.mjs    # Packaged app smoke test
├── src/
│   ├── main/
│   │   ├── update-service.ts         # Update coordinator
│   │   └── update-service.test.ts    # Unit tests
│   ├── shared/
│   │   └── update-state.ts           # Type definitions
│   ├── renderer/
│   │   ├── stores/
│   │   │   └── update.ts             # Update state store
│   │   └── components/
│   │       └── update/
│   │           └── UpdatePrompt.vue  # Update UI
│   └── preload/
│       └── index.ts                  # IPC bridge
├── tests/
│   └── e2e/
│       └── update-bridge.test.ts     # Integration tests
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Continuous integration
│       └── release.yml               # Release automation (deprecated)
└── docs/
    ├── operations/
    │   └── release-and-update-runbook.md  # Operations guide
    └── superpowers/
        ├── specs/
        │   └── 2026-04-24-windows-release-and-update-design.md
        └── plans/
            └── 2026-04-24-windows-release-and-update.md
```

---

## Implementation Status

Based on the design documentation and code analysis:

**✅ Completed:**
- electron-builder configuration with NSIS + GitHub publishing
- electron-updater integration with UpdateService
- Session-aware install guards
- Update state machine and IPC bridge
- Renderer update store and UI components
- Atomic writes and corruption backup
- Unsupported schema rejection
- CI workflow with artifact verification
- Comprehensive unit and E2E tests
- Documentation (design spec + implementation plan)

**⚠️ Partial:**
- GitHub Actions release workflow (deprecated, manual process preferred)
- E2E tests in CI (commented out)

**❌ Not in scope:**
- Code signing
- macOS/Linux release automation
- Beta/nightly channels
- Schema migrations (breaking changes only)

---

## Quality Gates

**Pre-release checks:**
1. `npm run test:generate` - Generate deterministic tests
2. `npm run typecheck` - Type checking
3. `npx vitest run` - Unit tests
4. `npm run test:e2e` - E2E tests (currently disabled)
5. `npm run test:behavior-coverage` - Behavior coverage verification
6. `npm run build` - Production build
7. `npm run package` - Package artifacts
8. `npm run verify:packaging` - Verify artifacts
9. `npm run verify:release-smoke` - Smoke packaged app

**All-in-one command:**
```bash
npm run test:all  # Runs full quality gate
npm run ci:local  # Full CI simulation locally
```

---

## Next Steps

For any modifications to the build/packaging system:

1. **Review design documents** - Start with the comprehensive design spec and implementation plan
2. **Test locally** - Use `npm run ci:local` before pushing
3. **Verify artifacts** - Always run `npm run verify:packaging` and `npm run verify:release-smoke`
4. **Update docs** - Keep the runbook in sync with any process changes
5. **Session safety** - Never bypass session guards without explicit justification
6. **State safety** - Maintain atomic writes and corruption backup

---

## Handoff Notes

This context report captures the complete state of the Electron build and packaging configuration as of version 0.3.3. All build configuration, update implementation, CI/CD pipelines, and design documentation have been catalogued.

The system is production-ready for Windows releases with comprehensive testing, session-safe updates, and state persistence hardening. The main limitation is the lack of code signing, which will cause SmartScreen warnings for new installations.