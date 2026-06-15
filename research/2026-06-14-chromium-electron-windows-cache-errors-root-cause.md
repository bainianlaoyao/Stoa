# Chromium / Electron Windows Cache Errors — Root Cause & Best-Practice Fixes

**Date:** 2026-06-14
**Scope:** `Unable to move the cache`, `Unable to create cache`, `Gpu Cache Creation failed: -2`, `Shader Cache Creation failed: -2`, and `Access is denied. (0x5)` on Windows for Electron/Chromium apps.
**Purpose:** Identify the *real environmental causes* (not generic troubleshooting) and the *best-practice fixes* that apply to this repository (`stoa`, Electron `^37.4.0` / Chromium 138-class).

---

## TL;DR (the single root cause)

All four error messages are **one bug with four log lines**. They occur when **two (or more) Chromium/Electron processes point at the same `userData` directory at the same time** — i.e. the same `GPUCache/`, `Cache/Cache_Data/`, and `LOCK` files are opened concurrently. The second process cannot get exclusive access, its cache init recovery path tries to **rename** the cache folder aside (`GPUCache` → `old_GPUCache_000`), Windows `MoveFileEx` returns **`ERROR_ACCESS_DENIED = 0x5`** because the first process still holds the directory, and the cascade prints:

```
[ERROR:cache_util_win.cc(20)] Unable to move the cache: Access is denied. (0x5)
[ERROR:cache_util.cc(146)]  Unable to move cache folder ...\GPUCache to ...\old_GPUCache_000
[ERROR:disk_cache.cc(208)]  Unable to create cache
[ERROR:gpu_disk_cache.cc(711)] Gpu Cache Creation failed: -2   # -2 == net::ERR_FAILED
```

This is **not** a hardware fault, not a permissions misconfiguration of the user profile, and not a virus / antivirus issue (those are the generic red herrings). The Electron maintainers have closed these reports as **won't-fix / by-design**, with the explicit statement:

> "Running multiple instances of an app with the same user-data directory isn't supported by Chrome, and thus isn't supported by Electron either."
> — Electron maintainer, on `electron/electron#33801` (and reaffirmed on the original `electron/electron#2157`)

The fixes are therefore **architectural**, not environmental: prevent concurrent same-`userData` instances, or give each instance its own `userData` / cache dir.

---

## What each log line actually means (Chromium source mapping)

| Log line | Chromium source | Meaning |
|---|---|---|
| `Unable to move the cache: Access is denied. (0x5)` | `net/disk_cache/cache_util_win.cc` | Windows cache backend tried to **rename** an existing cache directory aside (recovery after detecting dirty/stale/version-mismatched cache). `MoveFileEx` failed with `ERROR_ACCESS_DENIED` because another process holds the directory. |
| `Unable to move cache folder X to Y` | `net/disk_cache/cache_util.cc` | Cross-platform wrapper logging the failed rename (`X` = `...\GPUCache`, `Y` = `...\old_GPUCache_000`). |
| `Unable to create cache` | `net/disk_cache/disk_cache.cc` | After the rename failed, the backend could **not initialize a fresh cache**, so it degrades to in-memory / no cache. Non-fatal for the app, fatal for GPU/shader caching. |
| `Gpu Cache Creation failed: -2` | `gpu/ipc/service/gpu_disk_cache.cc` | GPU process reports its disk-cache init result code `-2`. `-2` corresponds to `net::ERR_FAILED`-style failure (cache backend returned a non-success status). Older Electron builds emit the sibling `Shader Cache Creation failed: -2` from `shader_disk_cache.cc`. |

Key detail from the Theia multi-instance logs (see Sources): the same contention also produces
`...LOCK: File currently in use. (ChromeMethodBFE: 15::LockFile::2)` on `IndexedDB`, proving the contention is **process-level exclusive-file-lock contention across the whole `userData` tree**, not specific to the GPU cache.

---

## Primary sources (cited)

All four error strings appear together in the same reproductions. Ranked by authority:

| # | Source | Authority | What it proves |
|---|---|---|---|
| 1 | **electron/electron#33801** — `[Bug]: ERROR:cache_util_win.cc(20)] Unable to move the cache: Access is denied` (Electron 17, Win10) — https://github.com/electron/electron/issues/33801 | Electron issue tracker, maintainer-closed | Canonical bug. Repro: "In 2 terminals run `npx electron`" → second instance throws the full cascade incl. `Shader Cache Creation failed: -2`. Maintainer closes as "multiple instances with the same user-data directory isn't supported." |
| 2 | **electron/electron#2157** — `Unable to move the cache` (Electron early, 2015) — https://github.com/electron/electron/issues/2157 | Electron issue tracker, original report | The earliest known occurrence; same root cause (shared cache dir); same maintainer statement. |
| 3 | **electron/electron#36237** — `[Bug]: ERROR:cache_util_win.cc(20)] Unable to move the cache: Zugriff verweigert (0x5)` (Electron 18, Win10 19041/19043/19044) — https://github.com/electron/electron/issues/36237 | Electron issue tracker | Confirms the error is OS-language-independent (`Zugriff verweigert` = "Access denied" in German) and reproduces across Win10 builds; same conclusion (multi-instance, same userData). |
| 4 | **eclipse-theia/theia#16757** — `Running Multiple Independent Instances of a Theia Electron Application` (discussion) — https://github.com/eclipse-theia/theia/discussions/16757 | Upstream framework discussion | Shows the exact full cascade (`Unable to move the cache: Access is denied. (0x5)` → `Unable to create cache` → `Gpu Cache Creation failed: -2`) plus the `LOCK: File currently in use` IndexedDB error, triggered precisely by setting `singleInstance: false` while keeping a shared userData dir. |
| 5 | **enso-org/enso#7162** — `Electron can't access cache Error` (Electron + Win11 22H2, RTX3060) — https://github.com/enso-org/enso/issues/7162 | Downstream app bug, blocking | Same cascade on packaged Electron on Windows; shows it is **not** a dev-only artifact. |
| 6 | **community.openai.com** — `Codex App not loading on Windows 10` — https://community.openai.com/t/codex-app-not-loading-on-windows-10/1379497 | Downstream app report (2024+) | Modern reproduction on a current Electron app; same four error strings. |
| 7 | **Electron docs — Supported Command Line Switches** — https://www.electronjs.org/docs/latest/api/command-line-switches | Official docs | Authoritative reference for `--disable-gpu`, `--disable-http-cache`, `--disk-cache-size`, `app.commandLine.appendSwitch(...)`, `--force_high_performance_gpu`, etc. Used for the fix matrix below. |
| 8 | **Electron docs — `app` (single-instance lock)** — https://electronjs.org/docs/latest/api/app (`requestSingleInstanceLock`) | Official docs | Authoritative API for the primary fix. |
| 9 | **Stack Overflow #77549752** — `Unable to move the cache: Access Denied (0x5) and Unable to create cache` — https://stackoverflow.com/questions/77549752/unable-to-move-the-cache-access-denied-0x5-and-unable-to-create-cache | Community Q&A (URL fetch blocked by reader proxy; listed for provenance) | Same symptom set; corroborating discussion. |

> Note on method: GitHub issue bodies and the Electron docs were fetched directly. The Stack Overflow URL was indexed by search but the reader proxy returned `Access to the requested URL is forbidden`; it is listed for traceability only and is **not** relied upon for any claim above.

---

## Why this is a real risk for THIS repository

Investigation of the actual source (not guesswork):

- **Electron `^37.4.0`** resolved to `37.10.3` (`node_modules/.pnpm/electron@37.10.3`) — a modern Chromium 138-class build whose cache line numbers (`cache_util_win.cc(20)`, `disk_cache.cc(208)`, `gpu_disk_cache.cc(711)`) match the upstream reports exactly. (`package.json:74`)
- **No single-instance lock.** A full read of `src/main/index.ts` (2069 lines) shows **no** `app.requestSingleInstanceLock()` call anywhere. The app relies entirely on the user not launching twice. (`src/main/index.ts` — entire file; no match for `requestSingleInstanceLock` in `src/`.)
- **Default Chromium `userData` is shared.** `app.setPath('userData', …)` is called **only** in packaged-smoke mode (`src/main/index.ts:185-190`). In normal dev, normal packaged, **and E2E mode**, the Chromium `userData` stays at the OS default `%APPDATA%\stoa` (app name = `stoa`, `package.json:2`), which means `GPUCache/`, `Cache/`, `Code Cache/`, and the `LOCK` file all live under one shared path.
- **E2E fixture isolates app state but NOT Chromium userData.** `tests/e2e-playwright/fixtures/electron-app.ts:110-162` sets `VIBECODING_STATE_DIR` to a unique temp dir per launch, but the main process only consumes that env var for `global.json` + the `.stoa-server` dir (`src/main/index.ts:167-169, 1542-1544`) — **not** for `app.setPath('userData')`. So when Playwright runs **parallel workers** (or `killAndRelaunch` / `relaunch` on lines 149-160 overlaps with a not-fully-dead GPU child process), every Electron instance points Chromium at the **same** `%APPDATA%\stoa\GPUCache`. This is the textbook trigger for `Unable to move the cache: Access is denied. (0x5)`.
- **The StoaCtl system shim re-invokes the Electron executable.** When `stoaCtlEnabled` is on, `ensureStoaCtlShim` / `ensureStoaCtlSystemShim` are invoked with `appExecutablePath: process.execPath` (`src/main/index.ts:90-100, 1130-1148`). Any code path that re-spawns `electron.exe` as a dispatcher without a distinct `--user-data-dir` is a candidate second-instance vector and should be audited.

**Conclusion for this repo:** the architecture currently permits two concurrent Electron processes against one `userData` dir. The reported cache errors are the expected, not anomalous, symptom under: parallel E2E, `relaunch`/`killAndRelaunch` overlap, or any StoaCtl-spawned child Electron that shares the default userData.

---

## Best-practice fixes (ranked, with official citations)

Ranked by correctness for a **production desktop app**. All are valid Electron APIs (Sources #7 and #8).

### Tier 1 — Eliminate the root cause (do this)

**1a. Enforce single-instance for the shipped app.**
```ts
// top of src/main/index.ts, BEFORE app.whenReady()
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()        // second instance exits immediately; never touches the cache
} else {
  app.on('second-instance', () => {
    // focus existing mainWindow instead of spawning a second process
  })
}
```
This is the **canonical Electron recommendation** and the direct answer to the maintainer's "don't run two instances on the same userData." Prevents the second process from ever opening the cache dir. (Ref: Electron `app` docs, Source #8.)

**1b. Give every legitimately-concurrent instance its own `userData`.**
For the cases where multiple instances are *intended* (parallel E2E workers, `killAndRelaunch`, StoaCtl child dispatchers), redirect Chromium's `userData` (or just the cache dir) to a per-instance path **before `app.whenReady()`**:
```ts
// for E2E / parallel workers
app.setPath('userData', path.join(stateDir, 'electron-userData'))
// or, lighter-weight, isolate only the cache:
app.commandLine.appendSwitch('disk-cache-dir', path.join(stateDir, 'gpu-cache'))
```
Critically for this repo: in `src/main/index.ts`, the E2E branch (`VIBECODING_E2E === '1'`) should call `app.setPath('userData', …)` using `VIBECODING_STATE_DIR`, the same way the packaged-smoke branch already does at lines 185-190. That single change removes the shared-`%APPDATA%\stoa` collision from the E2E path. (Ref: `app.setPath` + `command-line-switches` docs, Sources #7/#8.)

### Tier 2 — Defense-in-depth / silencing (use only when Tier 1 is insufficient)

**2a. Disable the GPU process entirely (kills GPU/shader cache).**
```ts
app.commandLine.appendSwitch('disable-gpu')
```
Removes the GPU process, so `GPUCache` / shader cache are never created and `Gpu Cache Creation failed: -2` cannot occur. **Cost:** loses hardware-accelerated rendering. Appropriate for headless/CI/test contexts where rendering speed is irrelevant. Widely used as a workaround in the openSUSE/Reddit reports and the Joplin forum thread. (Ref: `command-line-switches` docs, Source #7; community corroboration in Sources #5/#6.)

**2b. Disable the HTTP disk cache only.**
```ts
app.commandLine.appendSwitch('disable-http-cache')
```
Removes the HTTP disk cache (`Cache/Cache_Data`) but **does not** affect the GPU cache. Useful only if the HTTP-cache variant of `Unable to create cache` is the sole symptom. (Ref: `command-line-switches` docs — `--disable-http-cache`, Source #7.)

**2c. Ensure a clean settle before relaunch.**
The E2E `killAndRelaunch` already waits for the main process to exit (`waitForProcessExit`, `electron-app.ts:58-73`). On Windows the GPU child process can outlive the main process by a fraction of a second while it releases the `GPUCache` handles. Adding a short post-exit settle delay (or waiting for the cache dir to become writable) before relaunch closes the timing window. This **mitigates** but does not eliminate the risk — Tier 1b is still required for true parallel safety.

### Tier 3 — NOT fixes (red herrings to reject)

- ❌ "Run as administrator" — does not address cross-process lock contention; the second instance still can't move a held directory.
- ❌ "Antivirus exclusion / disable Defender" — popular on forums; unrelated to the actual cause (the lock is held by the *first instance of your own app*, not by AV).
- ❌ "Delete `%APPDATA%\stoa` and restart" — clears the symptom once by removing the held cache, but the next concurrent launch reproduces it. Treat as a one-shot reset, not a fix.
- ❌ "Grant NTFS permissions on the folder" — the failure is `ERROR_ACCESS_DENIED` from a **live file handle held by a sibling process**, not an ACL denial.

---

## Recommended action for this repo (concrete)

1. **`src/main/index.ts`** — add `app.requestSingleInstanceLock()` + `second-instance` focus handler at the very top (Tier 1a). This is the production-grade fix and is a small, self-contained change.
2. **`src/main/index.ts`** — extend the existing `VIBECODING_STATE_DIR` → `app.setPath('userData', …)` redirect from *packaged-smoke-only* (lines 185-190) to also cover `VIBECODING_E2E === '1'` (Tier 1b). Removes the parallel-worker collision in `tests/e2e-playwright`.
3. **`tests/e2e-playwright/fixtures/electron-app.ts`** — optionally pass a dedicated `--user-data-dir` (or `--disk-cache-dir`) per launch as belt-and-suspenders, so test isolation does not depend on the main-process branch.
4. **Audit `ensureStoaCtlSystemShim` / `ensureStoaCtlShim`** path (`src/main/index.ts:90-100, 1130-1148`): confirm any spawned `process.execPath` child runs with a distinct `--user-data-dir` (or `ELECTRON_RUN_AS_NODE`) so it cannot become a second GUI instance sharing `%APPDATA%\stoa`.

These are **breaking-change-safe** for the prototype (no compatibility shims introduced) and align with the project rule of preferring breaking changes over compatibility migrations.

---

## References (full URLs)

- Electron #33801 — https://github.com/electron/electron/issues/33801
- Electron #2157 — https://github.com/electron/electron/issues/2157
- Electron #36237 — https://github.com/electron/electron/issues/36237
- Theia discussion #16757 — https://github.com/eclipse-theia/theia/discussions/16757
- Enso #7162 — https://github.com/enso-org/enso/issues/7162
- OpenAI community — Codex App not loading on Windows 10 — https://community.openai.com/t/codex-app-not-loading-on-windows-10/1379497
- Electron docs — Supported Command Line Switches — https://www.electronjs.org/docs/latest/api/command-line-switches
- Electron docs — `app` (requestSingleInstanceLock) — https://electronjs.org/docs/latest/api/app
- Stack Overflow #77549752 (provenance only) — https://stackoverflow.com/questions/77549752/unable-to-move-the-cache-access-denied-0x5-and-unable-to-create-cache

---

## Context Handoff

**Saved report path (exact):**
```
D:\Data\DEV\ultra_simple_panel\research\2026-06-14-chromium-electron-windows-cache-errors-root-cause.md
```
Relative to repo root: `research/2026-06-14-chromium-electron-windows-cache-errors-root-cause.md`

Hand off to the implementation/planning step: the report's **"Recommended action for this repo"** section enumerates the 4 concrete, repo-specific changes (single-instance lock, E2E `userData` redirect, fixture `--user-data-dir`, StoaCtl-shim audit) ranked by priority and mapped to exact file/line references.
