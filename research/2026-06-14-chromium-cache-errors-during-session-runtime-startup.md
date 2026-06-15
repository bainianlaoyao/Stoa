# Chromium/Electron Cache Errors During Session Runtime Startup — Root-Cause Report

**Date:** 2026-06-14
**Scope:** Read-only diagnosis of the Chromium/Electron stderr errors
`Unable to move the cache`, `Unable to create cache`, and
`Gpu Cache Creation failed: -2` observed during session runtime startup.
**Mode:** Read-only context research. No code was modified.
**Depth:** gathered at depth=1 / max_depth=2; no further headless dispatched.

---

## 1. TL;DR — the root cause

The errors are emitted by the **Stoa Server (SR) child process** spawned by
`StoaServerSpawner` in **packaged mode**.

`StoaServerSpawner.spawn()` and `StoaServerSpawner.restart()` invoke Node's
`fork()` with the packaged **Electron binary** as the implicit `execPath`
(because `createForkExecOptions()` returns `{}` in packaged mode, so `fork()`
falls back to `process.execPath` = the Electron executable), but
`createChildEnv()` does **not** set `ELECTRON_RUN_AS_NODE=1`. Without that flag,
the packaged Electron binary boots the child as a **full Electron process** —
initializing Chromium, the GPU process, and the disk cache inside the same
default `userData` directory the parent Electron app already owns. Two Electron
processes sharing one `GPUCache` / disk-cache directory is the textbook cause
of exactly these three errors.

- The SR entry point is a pure Node HTTP/WS server
  (`stoa-server/src/index.ts:1-18` — imports `@hono/node-server`, `node:*`;
  **zero `electron` imports**), so it is *meant* to run as Node, not Electron.
- The established in-repo pattern for "run the packaged Electron binary as pure
  Node" is to set `env: { ELECTRON_RUN_AS_NODE: '1' }` — see
  `src/core/stoa-ctl-shim.ts:48-75`, which does exactly this for the stoa-ctl
  shim. **The SR spawner is the only Electron-binary-as-node invocation in the
  repo that omits it.**
- Dev mode is **masked** because `createForkExecOptions()` sets `execPath` to the
  real Node binary (`process.env.npm_node_execpath`) in dev
  (`stoa-server-spawner.ts:327-335`), so SR runs as pure Node there regardless of
  the env flag. The bug is only observable in **packaged** builds — which matches
  the "works in dev, noisy/crashy when packaged" symptom profile.
- The test `src/main/stoa-server-spawner.test.ts:389` explicitly asserts
  `expect(mockFork.mock.calls[0][2]).not.toHaveProperty('execPath')` in packaged
  mode — this **codifies** the buggy configuration (no custom execPath, no env
  flag).

### Why it surfaces "during session runtime startup"

SR is spawned synchronously inside `app.whenReady()` at
`src/main/index.ts:1611-1616` (`spawn()` → `waitForHealth()` → `connectRuntime()`)
**right before** the main window is created (`index.ts:2010`) and **right
before** the bootstrap-recovery session launches (`index.ts:2028-2030`). So the
SR child's Chromium-init stderr lands in the same time window as session runtime
startup, even though the sessions themselves (`claude.exe` / `codex` /
`powershell.exe` spawned via `node-pty` in `src/core/pty-host.ts:115`) are plain
CLI processes and are **not** the source of Chromium/GPU cache errors.

---

## 2. Evidence trail (file:line citations)

### 2a. The fork that boots SR as Electron

`src/main/stoa-server-spawner.ts:181-213` — `spawn()`:

```ts
this.process = fork(entryPoint, ['--port', String(this.port), '--web'], {
  stdio: 'pipe',
  env: this.createChildEnv(),
  ...this.createForkExecOptions()   // ← {} in packaged mode
})
```

`src/main/stoa-server-spawner.ts:358-390` — `restart()` does the same `fork()`
at `:366` with the identical options shape.

### 2b. `createChildEnv()` omits the flag

`src/main/stoa-server-spawner.ts:319-325`:

```ts
private createChildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,            // ← inherits parent's (Electron) env; no ELECTRON_RUN_AS_NODE
    STOA_AUTH_TOKEN: this.authToken,
    STOA_DIR: this.config.stoaDir
  }
}
```

It spreads `process.env` (which in the Electron parent does **not** have
`ELECTRON_RUN_AS_NODE` set — the parent *is* Electron) and adds only SR-specific
vars. No `ELECTRON_RUN_AS_NODE`.

### 2c. `createForkExecOptions()` — the dev/packaged asymmetry

`src/main/stoa-server-spawner.ts:327-335`:

```ts
private createForkExecOptions(): { execPath?: string } {
  if (this.deps.isPackaged) {
    return {}                    // ← packaged: no execPath → fork() uses process.execPath (Electron)
  }
  return {
    execPath: this.deps.getNodeExecPath()   // ← dev: real Node binary → masks the bug
  }
}
```

When `execPath` is omitted, Node's `fork()` default is `process.execPath`
([Node docs](https://nodejs.org/api/child_process.html#child_processforkmodulepath-args-options)).
In a packaged Electron app, `process.execPath` is the Electron executable.

### 2d. The in-repo pattern that proves the intent

`src/core/stoa-ctl-shim.ts:48-75` — `resolveStoaCtlInvocationPlan()`:

```ts
if (options.isPackaged) {
  return {
    executablePath: options.appExecutablePath,   // = process.execPath (Electron binary)
    args: [ ... ],
    env: {
      ELECTRON_RUN_AS_NODE: '1'                  // ← THIS is the correct pattern
    }
  }
}
// dev branch also sets ELECTRON_RUN_AS_NODE: '1'  (line 72)
```

The stoa-ctl shim invokes the **same packaged Electron binary** as a pure Node
process and explicitly sets `ELECTRON_RUN_AS_NODE: '1'` in both packaged and dev
branches. This is the canonical fix the SR spawner is missing.

### 2e. SR entry point is pure Node (not Electron)

`stoa-server/src/index.ts:1-18`:

```ts
import { serve } from '@hono/node-server';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
// ... no `electron` import anywhere in the entry
```

SR is a Hono HTTP server + WebSocket hub. It has no use for Chromium. Running it
as Electron is purely an accident of the missing env flag.

### 2f. The test codifies the bug

`src/main/stoa-server-spawner.test.ts:380-390`:

```ts
await spawner.spawn()
expect(mockFork).toHaveBeenCalledWith(
  join('/usr/resources', 'stoa-server', 'index.cjs'),
  ['--port', '5000', '--web'],
  expect.objectContaining({
    stdio: 'pipe',
    env: expect.objectContaining({ STOA_AUTH_TOKEN: 'tok', STOA_DIR: stoaDir })
  })
)
expect(mockFork.mock.calls[0][2]).not.toHaveProperty('execPath')
```

The `env` expectation checks `STOA_AUTH_TOKEN` and `STOA_DIR` but **does not**
assert `ELECTRON_RUN_AS_NODE`. So the test passes while the bug is live.

### 2g. Nothing else in the main app disables GPU / isolates cache

A repo-wide search for `disableHardwareAcceleration`,
`app.commandLine.appendSwitch`, `--disable-gpu`, custom `session.fromPartition`,
or cache-path overrides returns **zero hits** in `src/` (only unrelated upstream
vendored hits). The main window config is a vanilla BrowserWindow
(`src/main/index.ts:470-485`) with no `partition` or cache customization. The
**only** Electron binary re-invocation in the Stoa-owned tree is the SR spawner.

### 2h. Session commands are CLI processes, not Electron

`src/core/session-runtime.ts:92-150` → `ptyHost.start()` → `src/core/pty-host.ts:115`
(`pty.spawn(spawnCommand, spawnArgs, ...)`). The spawned commands are
`C:\Users\30280\.local\bin\claude.exe`, `codex`, `powershell.exe`, `cmd.exe`
(see `tmp-startup-stdout.log:42,100,329,338`). None of these are Electron or
Chromium, so they cannot emit GPU-cache errors. This rules out the session PTY
spawns as the source.

---

## 3. Mechanism — why these three exact errors

When the packaged Electron binary is `fork()`-ed without `ELECTRON_RUN_AS_NODE`:

1. The child boots as an **Electron main process** (not Node). Electron
   initializes its Chromium runtime, which spawns a **GPU process** as a child
   of the SR child.
2. Both the parent app and the SR child resolve the default `userData` directory
   to the same path (`<appData>/<appName>/`, e.g.
   `%APPDATA%/Stoa/` on Windows), because neither sets a custom `app.setPath`
   or a distinct `--user-data-dir`.
3. The GPU process writes its shader cache under `<userData>/GPUCache/`. Two
   GPU processes from two Electron instances racing on one `GPUCache/` directory
   collide on the lockfile / `index` files → **`Gpu Cache Creation failed: -2`**
   (Chromium `CREATE_CACHE_FAILED`).
4. The network/disk `SimpleCache` backend (used by Chromium's `HttpCache`) tries
   to rename staging directories under `<userData>/Cache/` / `<userData>/Code
   Cache/`. Concurrent access from two Chromium instances fails the
   `base::Move`/`Create` → **`Unable to move the cache`** and
   **`Unable to create cache`**.

These three messages are co-emitted by Chromium's disk-cache and GPU-process
init paths; their co-occurrence is the fingerprint of "two Chromium instances on
one userData dir".

---

## 4. Why dev mode hides it

In dev, `createForkExecOptions()` returns `{ execPath: getNodeExecPath() }`
where `getNodeExecPath()` = `process.env.npm_node_execpath ?? 'node'`
(`src/main/index.ts:1554`). `npm_node_execpath` is set by npm/electron-vite to
the real Node binary, so SR forks as pure Node → no Chromium init → no cache
errors. `tmp-startup-stdout.log` (which is a `electron-vite dev` run, see
`tmp-startup-stdout.log:1-33`) shows clean session-runtime activity with no
GPU/cache noise, consistent with this.

This asymmetry — *dev uses Node execPath, packaged uses Electron execPath* — is
the reason the bug is easy to miss and only surfaces in packaged/E2E-of-packaged
runs.

---

## 5. Concrete fix direction (recommended order)

### Fix A (primary, smallest, matches in-repo pattern) — set `ELECTRON_RUN_AS_NODE` in packaged mode

In `src/main/stoa-server-spawner.ts`, update `createChildEnv()` (or the fork
call sites at `:191` and `:366`) so that, **when `isPackaged` is true**, the
child env carries `ELECTRON_RUN_AS_NODE: '1'`. This is exactly what
`src/core/stoa-ctl-shim.ts:55-57` does. Since SR's entry point has no `electron`
import (`stoa-server/src/index.ts:1-18`), running it as Node is both safe and
correct, and it removes the Chromium/GPU init entirely from the child.

Sketch:

```ts
private createChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STOA_AUTH_TOKEN: this.authToken,
    STOA_DIR: this.config.stoaDir
  }
  if (this.deps.isPackaged) {
    // Run the packaged Electron binary as pure Node — SR is a Node HTTP server,
    // not an Electron app. Without this, the child boots Chromium and fights
    // the parent app over the shared userData/GPUCache directory.
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  return env
}
```

The `if (this.deps.isPackaged)` guard keeps dev-mode behavior byte-identical
(dev already uses a real Node `execPath`, where the flag is a no-op). Setting it
unconditionally is also fine and arguably more robust.

**Also update the test** at `src/main/stoa-server-spawner.test.ts:384-388` to
assert `ELECTRON_RUN_AS_NODE: '1'` in the packaged-mode fork env (and add the
inverse assertion that dev mode does not require it, or asserts it is harmless).

### Fix B (belt-and-suspenders) — give the child its own userData

Even with Fix A, defensively pass a distinct `--user-data-dir=<STOA_DIR>/.electron-cache`
to any future Electron-binary child, so that even a future regression cannot
collide with the parent's `GPUCache`. This is not needed if Fix A is in place,
but is a cheap guard. (Not recommended as the *only* fix — it still pays the
Chromium-init cost for no benefit, since SR is Node-only.)

### Fix C (alternative) — bundle a real Node binary for packaged SR

Have `createForkExecOptions()` return a `execPath` pointing at a bundled Node
binary in `resources/` even in packaged mode. This sidesteps the Electron-binary
problem entirely but adds packaging weight and is more invasive than Fix A. Not
recommended unless there is a separate reason SR cannot run under Electron's
embedded Node (there is not — Electron's Node ABI is fine for `@hono/node-server`).

### Recommendation

**Fix A.** It is a 4-line change in one file, mirrors an existing proven pattern
in the same repo (`stoa-ctl-shim.ts`), and directly removes the Chromium
initialization that produces all three errors. Pair it with the test update so
the guard cannot regress.

---

## 6. Secondary / alternative hypotheses (considered and ruled lower-priority)

- **H1 — Main window's own GPU/cache errors from a stale lockfile.** If the app
  previously crashed, a stale `GPUCache/` lockfile can make the *parent* emit
  these errors on next start. Possible, but: (a) only one BrowserWindow is ever
  created (`src/main/index.ts:471`), (b) no custom userData path is set so the
  directory is the standard one, and (c) the symptom would be intermittent and
  self-healing, not a stable reproducer. Treat as a *secondary* contributor at
  most; the SR fork is the structural, always-reproducing cause.
- **H2 — Two Stoa app instances running.** A user launching the packaged app
  twice would also collide on the same userData cache. Out of repo scope (user
  behavior), but worth noting that Fix A does not address this; a single-instance
  lock (`app.requestSingleInstanceLock()`) would. Not currently present in
  `src/main/index.ts`.
- **H3 — Session PTY spawns.** Ruled out (§2h). `claude.exe`/`codex`/shell are
  CLI processes.
- **H4 — `promo-electron-capture.ts` Electron launch.** Uses Playwright's
  `electron.launch({ args: [entryPath] })` with a fresh `VIBECODING_STATE_DIR`
  (`src/core/promo/promo-electron-capture.ts:388-403`), and is a dev-only
  capture tool, not a runtime path. Not the runtime-startup source.

---

## 7. Verification steps (cheap, high-signal)

1. **Confirm the channel.** In a packaged build, capture the SR child's stderr
   directly. The spawner pipes SR stdout/stderr through
   `[sr:stdout]`/`[sr:stderr]` prefixes
   (`stoa-server-spawner.ts:197-202`, `:372-377`). The three cache errors should
   appear under `[sr:stderr]` — confirming they come from the SR child, not the
   parent app.
2. **Confirm the flag fixes it.** Apply Fix A, rebuild the packaged app, and
   re-capture `[sr:stderr]`. The cache errors should be gone, and SR health
   check (`waitForHealth`) should still pass (SR's HTTP server is unaffected by
   the env flag).
3. **Confirm dev is unaffected.** `tmp-startup-stdout.log` is already clean in
   dev; Fix A's `isPackaged` guard keeps it that way.

---

## 8. File / citation map

| Concern | File:line |
|---|---|
| SR fork with Electron binary, no env flag (spawn) | `src/main/stoa-server-spawner.ts:181-213` (esp. `:191`) |
| SR fork with Electron binary, no env flag (restart) | `src/main/stoa-server-spawner.ts:358-390` (esp. `:366`) |
| **`createChildEnv()` omits `ELECTRON_RUN_AS_NODE` (BUG)** | `src/main/stoa-server-spawner.ts:319-325` |
| `createForkExecOptions()` — packaged `{}`, dev Node | `src/main/stoa-server-spawner.ts:327-335` |
| `getNodeExecPath()` source (dev masking) | `src/main/index.ts:1554` |
| In-repo correct pattern (`ELECTRON_RUN_AS_NODE: '1'`) | `src/core/stoa-ctl-shim.ts:48-75` |
| Test codifying the bug (no execPath, no env flag asserted) | `src/main/stoa-server-spawner.test.ts:380-390` |
| SR entry point is pure Node (no `electron` import) | `stoa-server/src/index.ts:1-18` |
| SR spawned before window + bootstrap recovery (timing) | `src/main/index.ts:1611-1616`, `:2010`, `:2028-2030` |
| Only BrowserWindow (vanilla, no cache/partition config) | `src/main/index.ts:470-485` |
| No GPU-disable / commandLine switch anywhere in `src/` | (zero hits — see §2g) |
| Session PTY spawns are CLI processes, not Chromium | `src/core/pty-host.ts:115`; `tmp-startup-stdout.log:42,100,329` |

---

## 9. One-line summary

In packaged mode `StoaServerSpawner` `fork()`s the pure-Node Stoa Server using
the **Electron binary** as `execPath` (`stoa-server-spawner.ts:191`/`:366`,
because `createForkExecOptions()` returns `{}` when packaged) while
`createChildEnv()` (`:319-325`) omits `ELECTRON_RUN_AS_NODE=1` — so the child
boots as a second full Electron process that initializes Chromium/GPU and
collides with the parent app's shared `userData`/`GPUCache`, emitting
`Unable to move the cache`, `Unable to create cache`, and
`Gpu Cache Creation failed: -2`. The fix is to set `ELECTRON_RUN_AS_NODE: '1'`
in the child env in packaged mode, mirroring the existing pattern in
`src/core/stoa-ctl-shim.ts:55-57`.
