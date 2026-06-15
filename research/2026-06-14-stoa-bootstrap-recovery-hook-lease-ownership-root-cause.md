# STOA Bootstrap Recovery — "is owned by another STOA instance" Root Cause

**Date:** 2026-06-14
**Scope:** Why logs like
`[bootstrap-recovery] Failed to start session <id>: Error: Session <id> is owned by another STOA instance`
appear during app startup, and the concrete fix direction.

**Mode:** Read-only context research. No code was modified. All claims cite
`file:line` and were verified against the current tree.

---

## 0. TL;DR

The hook-lease "ownership" guard is designed for **multi-instance mutual
exclusion**, but STOA is a **single desktop process**. On every app start a
fresh `instanceId` is minted (`src/main/index.ts:601`), so any lease written by
a previous process is, by construction, "owned by another instance." When the
previous process was **force-killed** (Ctrl+C / crash / `taskkill /F` / OS
shutdown — confirmed by Windows exit code `0xC000013A` in
`tmp-startup-stdout.log:403`), its leases are never `release`d, and
bootstrap-recovery fires **within the 20 s lease TTL** (`hook-lease-registry.ts:89`).
`ensureLease` then sees `active` + foreign-owner + not-yet-expired and throws
(`hook-lease-manager.ts:105`). The recovery loop has no retry, so every such
session is marked `failedToStart` and stays dead until the user manually
restarts again after the TTL elapses.

**The single highest-leverage fix:** allow bootstrap-recovery to reclaim an
active-but-foreign lease (new `force`/`takeover` path in the registry, or relax
the `reclaim` precondition when the caller is a recovery context), because in a
single-instance desktop app "another instance" is always a *dead previous boot*.
Secondary: register abnormal-shutdown handlers so leases are released on
`SIGINT`/crash, narrowing the window where stale active leases exist.

---

## 1. The exact error and where it is thrown

**Throw site:** `src/main/hook-lease-manager.ts:105`

```ts
throw new Error(`Session ${input.sessionId} is owned by another STOA instance`)
```

This is inside `ensureLease` (`hook-lease-manager.ts:57-111`). The full branch
ladder is:

```ts
// hook-lease-manager.ts:73-106
const existing = await registry.read(input.sessionId)
if (!existing.lease) {                                     // (A) no lease on disk -> acquire
  binding = await registry.acquire(...)
} else if (
  existing.lease.leaseState === 'active'
  && existing.lease.ownerInstanceId === options.instanceId
  && !registry.isExpired(existing.lease)                    // (B) mine + live -> reuse
) {
  binding = { path: existing.path, lease: existing.lease }
} else if (
  existing.lease.leaseState === 'released'
  || registry.isExpired(existing.lease)                     // (C) released OR expired -> reclaim
) {
  const reclaimed = await registry.reclaim(...)
  ...
} else {                                                    // (D) <-- THE THROW
  throw new Error(`Session ${input.sessionId} is owned by another STOA instance`)
}
```

**Precise condition to reach branch (D)** (derived by negating B and C given
that a lease exists and `leaseState ∈ {'active','released'}`):

- `leaseState === 'active'` (otherwise C would catch it), **AND**
- `ownerInstanceId !== options.instanceId` (otherwise B would catch it, since
  not-expired is implied), **AND**
- `!isExpired(existing.lease)` (otherwise C would catch it).

So: **an on-disk lease that is `active`, owned by a *different* `instanceId`,
and still inside its TTL.** Nothing else triggers this throw.

### 1a. The log line the user sees

The throw propagates up to `launchSessionRuntimeWithGuard`, whose catch block
emits the user-visible log:

```ts
// src/main/index.ts:1180-1184
} catch (err: unknown) {
  console.error(`[${source}] Failed to start session ${sessionId}:`, err)
  await runtimeController.markRuntimeFailedToStart(sessionId, `启动失败: ${err instanceof Error ? err.message : String(err)}`)
  return false
}
```

With `source === 'bootstrap-recovery'` this prints exactly the reported shape:
`[bootstrap-recovery] Failed to start session <id>: Error: Session <id> is owned by another STOA instance`.

---

## 2. The call chain: bootstrap recovery → ensureLease

1. **Bootstrap recovery entry** — `src/main/index.ts:2028-2030`, near the end of
   `app.whenReady().then(...)`:

   ```ts
   for (const plan of projectSessionManager.buildBootstrapRecoveryPlan()) {
     void launchSessionRuntimeWithGuard(plan.sessionId, 'bootstrap-recovery')
   }
   ```

2. **The plan covers every live session** — `src/core/project-session-manager.ts:370-383`:

   ```ts
   buildBootstrapRecoveryPlan() {
     const activeSessions = this.getSessionsInTreeOrder().filter((session) => !session.archived)
     return activeSessions.map((session) => { ... })
   }
   ```

   No filter on runtime state — every non-archived session is scheduled for
   recovery, and each one independently calls `ensureLease`.

3. **Guard body** — `src/main/index.ts:1100-1185` wraps
   `launchTrackedSessionRuntime` in the try/catch quoted in §1a.

4. **`launchTrackedSessionRuntime`** — `src/main/launch-tracked-session-runtime.ts:52-57`
   is the single call site of `ensureLease` for this path:

   ```ts
   const hookLease = await options.hookLeaseManager.ensureLease({
     sessionId: session.id,
     projectId: session.projectId,
     sessionType: session.type,
     webhookBaseUrl: `http://127.0.0.1:${options.webhookPort}`
   })
   ```

5. **`ensureLease`** — `src/main/hook-lease-manager.ts:57-111` → branch (D) throws.

> **Same throw, other entry points (for completeness):**
> `ensureLocalSessionHookBinding` (`src/main/index.ts:1068-1098`, esp. `:1082`)
> also calls `activeHookLeaseManager.ensureLease`. It backs the SR-owned launch
> path (`launchSrOwnedSessionRuntime`, `index.ts:1202`). So session-create /
> session-restore / session-restart / SR-owned launches all share this failure
> mode; bootstrap-recovery is simply the noisiest because it fires for *every*
> session at once.

---

## 3. Why branch (D) is reached on restart — three converging facts

### 3a. `instanceId` is regenerated every boot

`src/main/index.ts:599-602`:

```ts
hookLeaseManager = createHookLeaseManager({
  runtimeRoot,
  instanceId: `stoa-${process.pid}-${Date.now()}`
})
```

`process.pid` and `Date.now()` are both per-process. **There is no persistence
of `instanceId` across restarts** (no file read, no env reuse, no reuse of a
prior PID). Therefore after *any* restart:

```ts
existing.lease.ownerInstanceId === options.instanceId   // always false for a lease from a prior boot
```

Branch (B) can never match a foreign-boot lease. The only thing that lets a new
boot take over is branch (C) — released or expired.

### 3b. The TTL window is 20 s; heartbeat every 5 s

`src/main/hook-lease-registry.ts:89-92`:

```ts
const DEFAULT_LEASE_DURATION_MS = 20_000
const DEFAULT_LOCK_DURATION_MS = 10_000
```

`createHookLeaseManager` is called at `index.ts:599` **without** `leaseDurationMs`
or `heartbeatIntervalMs`, so the defaults apply: 20 s lease, 5 s heartbeat
(`hook-lease-manager.ts:53`).

`isExpired` (`hook-lease-registry.ts:260-262`) is a strict `expiresAt < now`.
While a lease is live, `heartbeat` (`hook-lease-registry.ts:160-191`) keeps
sliding `expiresAt` forward by 20 s every 5 s. So an active session's lease is
effectively always "fresh."

When the owning process dies, the last-written `expiresAt` is at most ~20 s in
the future. A restart within that window hits branch (D); a restart after it
hits branch (C) and reclaims cleanly.

### 3c. Force-kill bypasses the only release path

Leases are written `leaseState: 'released'` **only** by `registry.release`
(`hook-lease-registry.ts:228-258`), which is called from
`HookLeaseManager.releaseLease` (`hook-lease-manager.ts:157-171`), which is
called from `HookLeaseManager.stop` (`hook-lease-manager.ts:203-206`), which is
called **only** from `prepareForQuitAndInstall` (`src/main/index.ts:375`),
which is called **only** from the `before-quit` handler
(`src/main/index.ts:2045-2062`):

```ts
app.on('before-quit', async (event) => {
  if (isQuittingAfterBridgeStop) { unsubscribeStoaCtlGate(); return }
  event.preventDefault()
  try {
    await deleteCtlPortFile()
    await prepareForQuitAndInstall()   // <-- calls hookLeaseManager?.stop()
    if (srSpawner) { await srSpawner.shutdown() }
  } finally {
    unsubscribeStoaCtlGate()
    app.quit()
  }
})
```

This is an **async** handler that does `event.preventDefault()` then async work
then `app.quit()`. Any termination that does not let this async chain run to
completion leaves leases `active` on disk:

- `SIGKILL` / `taskkill /F` / Task Manager "End Task"
- Power loss, blue screen, OS forced shutdown
- `process.crash()` / native crash in the main process
- Ctrl+C in the dev terminal (`Ctrl+C` → on Windows often maps to
  `STATUS_CONTROL_C_EXIT` rather than a graceful `SIGINT`-to-`before-quit`)
- A hang during `prepareForQuitAndInstall` itself followed by the user force-closing

**Evidence in repo:** `tmp-startup-stdout.log:403`:

```
 ELIFECYCLE  Command failed with exit code 3221225786.
```

`3221225786 = 0xC000013A = STATUS_CONTROL_C_EXIT` — a Windows abnormal
termination, not a graceful `before-quit`. After this exit, no lease was
released, and the next `npm run dev` restart raced the 20 s TTL.

> Note: there is **no** `app.requestSingleInstanceLock()` anywhere in
> `src/main/` (verified by grep). The mutex the lease guard provides has no
> real concurrent-instance adversary in the single-instance desktop deployment.

---

## 4. Putting it together — the failure timeline

```
T=0     App boot #1, instanceId = "stoa-1234-1718000000000"
        Session S created → ensureLease → acquire writes
        { leaseState:'active', ownerInstanceId:'stoa-1234-1718000000000',
          expiresAt: T+20s, heartbeatAt: T } to runtimeRoot/hook-leases/S.json
        Heartbeat slides expiresAt forward every 5 s while running.

T=60s   User hits Ctrl+C (or app crashes). Exit code 0xC000013A.
        before-quit async chain does NOT complete → release never runs.
        S.json stays { leaseState:'active', ownerInstanceId:'stoa-1234-…',
                       expiresAt: T+65s }   (last heartbeat ~5 s ago)

T=70s   App boot #2, instanceId = "stoa-2468-1718000060000"  (NEW)
        buildBootstrapRecoveryPlan() -> [S, ...]   (index.ts:2028)
        launchSessionRuntimeWithGuard(S, 'bootstrap-recovery')   (index.ts:2029)
        launchTrackedSessionRuntime -> ensureLease(S)            (launch-tracked-session-runtime.ts:52)
        registry.read(S) -> existing = { active, owner 'stoa-1234-…', expiresAt T+65s, now T+70s }
        branch B fails: ownerInstanceId !== current ('stoa-2468-…')
        branch C fails: leaseState !== 'released' AND not expired (expiresAt T+65s < T+70s? borderline;
                        if restart was faster, clearly still live)
        branch D -> THROW "Session S is owned by another STOA instance"
        guard catch (index.ts:1181) logs the error, markRuntimeFailedToStart(S)
        S stays dead. No retry. User must restart again after the TTL.
```

The borderline case in the timeline above is the core race: bootstrap recovery
runs **immediately** (`void launchSessionRuntimeWithGuard(...)`, `index.ts:2029`
— `void`, no `await`, no backoff), so the only question is whether the previous
lease's `expiresAt` has slipped into the past. With a 5 s heartbeat cadence and
a 20 s TTL, a restart within ~15–20 s of the last heartbeat reproduces the throw
deterministically.

---

## 5. Root causes (ranked)

### RC1 (primary) — ephemeral `instanceId` + reclaim blocked inside the TTL

The lease protocol treats "active lease owned by a different `instanceId`" as
"possibly-live peer, do not touch." But because `instanceId` is reminted every
boot (`index.ts:601`), *every* lease from a prior boot is foreign. The TTL is
the only death signal, and `ensureLease` offers no way to wait it out or
force a takeover. So a clean restart within the TTL is indistinguishable from a
hostile concurrent instance — even though no such instance exists in this
deployment. **This is the design gap that turns every fast restart-after-crash
into a hard failure.**

### RC2 (contributing) — force-kill leaves leases permanently `active`

`release` runs only on the async `before-quit` path (`index.ts:2045-2062` →
`:375`). Every abnormal exit (crash, `SIGKILL`, Ctrl+C-as-`0xC000013A`, power
loss) leaves `active` leases on disk. This is what *creates* the stale-active
state RC1 then trips over.

### RC3 (contributing) — bootstrap recovery has no retry/backoff

`index.ts:2028-2030` issues a single `void launchSessionRuntimeWithGuard(...)`
per session. On throw, the guard marks the session `failedToStart`
(`index.ts:1182`) and never retries. Even a one-shot "sleep until `expiresAt` +
ε, then retry" would self-heal the TTL race without any lease-protocol change.

---

## 6. Concrete fix directions

All options below are **breaking changes** (per `CLAUDE.md` "no compatibility
code" rule for this prototype phase) — they change lease semantics, not paper
over them.

### Fix A — Allow recovery to take over an active-foreign lease (RECOMMENDED)

Add a `force`/`takeover` capability so that the recovery path can reclaim a
lease that is `active` but whose owner is provably not the current process.

**Why this is the right primary fix:** STOA is a single-instance desktop app
(no `requestSingleInstanceLock` is even registered). "Another STOA instance" is
in practice *always* a dead previous boot. Defending against a live second
instance is a threat model that does not exist in this deployment.

**Implementation shape (two viable variants):**

- **A1 — relax `registry.reclaim`'s precondition.** Today `reclaim` returns
  `null` unless `leaseState === 'released' || isExpired`
  (`hook-lease-registry.ts:202-204`). Add a `force?: boolean` input that, when
  set, skips that guard and unconditionally rewrites the lease with
  `generation + 1` and the current `ownerInstanceId`. Then thread a
  `recovery?: boolean` (or `forceReclaim?: boolean`) flag from
  `launchSessionRuntimeWithGuard` (only when `source === 'bootstrap-recovery'`)
  through `launchTrackedSessionRuntime` → `ensureLease` → `registry.reclaim`.

- **A2 — new registry operation `takeover`.** Cleaner separation: keep
  `reclaim` strict, add `takeover({ sessionId, webhookBaseUrl })` that ignores
  current state and always writes a fresh active lease with `generation + 1`.
  `ensureLease` calls `takeover` only when the caller passes the recovery flag
  and branch (D) would otherwise throw.

Either variant is ~30–60 lines and localized to `hook-lease-registry.ts`,
`hook-lease-manager.ts`, and the two call sites
(`launch-tracked-session-runtime.ts:52`, `index.ts:1082`).

**Risk:** if a *real* second STOA instance ever runs (not currently possible),
this lets the recovery boot steal the other's lease. Mitigate by also adding
`requestSingleInstanceLock` (Fix D) so the threat model stays vacuous.

### Fix B — Persist `instanceId` per-process-lifecycle with liveness check

Write the boot's `instanceId` + `pid` to a file in `runtimeRoot`. On startup,
read it; if the recorded `pid` is no longer alive (`process.kill(pid, 0)`
throws), reuse the recorded `instanceId` so branch (B) matches and the lease is
reused cleanly. If the pid *is* alive, fall back to a new `instanceId` (real
concurrent instance).

**Pros:** no semantic change to the lease protocol; branch (B) just starts
matching.
**Cons:** PID reuse on Windows/Linux can produce false "alive" verdicts (the OS
recycled the dead pid to an unrelated process). Weaker than Fix A and more
moving parts. Not recommended as the primary fix; useful only if the lease
mutex must remain strict.

### Fix C — Make bootstrap recovery wait out the TTL

In `launchSessionRuntimeWithGuard`, when the caught error matches
"owned by another STOA instance" and `source === 'bootstrap-recovery'`, sleep
until `existingLease.expiresAt + buffer` and retry `ensureLease` once.

**Pros:** zero lease-protocol change; purely additive retry.
**Cons:** adds up to ~20 s startup latency per affected session (or per batch
if serialized). Does not fix RC2; just papers over RC1. Acceptable as a
stopgap, not as the real fix.

### Fix D — Release leases on abnormal shutdown (RC2 mitigation)

Register best-effort release on every exit vector Electron/Node exposes:

- `process.on('SIGINT')` / `process.on('SIGTERM')` → `hookLeaseManager.stop()`
  (synchronous best-effort, since handlers may not await).
- `process.on('exit')` — sync only; can do a blocking `fs.writeFileSync` of
  tombstones marking each tracked lease `released`, but cannot await the
  registry's async lock path. Partial.
- `app.on('render-process-crashed')`, `app.on('gpu-process-crashed')` — these
  do NOT kill the main process, so they are mostly irrelevant to lease release
  but worth auditing.
- Add `app.requestSingleInstanceLock()` so a second instance redirects to the
  first instead of racing it; this also makes Fix A safe.

**Cannot cover:** `SIGKILL`, power loss, blue screen. So Fix D narrows the
window but cannot close it. Pair with Fix A.

### Recommended combination

**Fix A (primary) + Fix D (belt-and-suspenders).** Fix A makes recovery robust
to any stale-active lease regardless of how it got there; Fix D reduces how
often stale-active leases exist at all and re-establishes the single-instance
invariant via `requestSingleInstanceLock`.

---

## 7. Verification steps (for whoever implements the fix)

- **V1 — Reproduce deterministically.** With a temp `runtimeRoot`, call
  `createHookLeaseManager({ instanceId: 'A' })`, `ensureLease(S)` (writes
  active lease), then `createHookLeaseManager({ instanceId: 'B' })` with the
  same `runtimeRoot` and call `ensureLease(S)` within 20 s. Confirm it throws
  the exact error from `hook-lease-manager.ts:105`. This is the regression test
  to add alongside Fix A.
- **V2 — Confirm no lease persistence / lock files leak.** After a forced
  ungraceful exit, inspect `<runtimeRoot>/hook-leases/` for lingering
  `<sessionId>.json` (active) and `<sessionId>.lock/` dirs. The lock dir is
  cleaned in `withSessionMutationLock`'s `finally` (`hook-lease-registry.ts:337-339`),
  so only the lease JSON should remain; confirm.
- **V3 — Confirm `before-quit` is the only release trigger.** Grep confirms
  `releaseLease` / `stop` callers are only `index.ts:375`, `:1922`
  (session-restart path), and tests. No `SIGINT`/`SIGTERM`/`exit` handler calls
  them. (Verified during this research.)
- **V4 — Confirm Fix A does not regress the multi-instance test.**
  `hook-lease-manager.test.ts` has no test for the foreign-active case today
  (the three tests cover auth, auth-reject, and release-tombstone only). The
  new V1 test + a test that `force: true` reclaims an active-foreign lease
  should be added together.
- **V5 — Confirm `requestSingleInstanceLock` absence.** `grep -rn
  requestSingleInstanceLock src/main` returns nothing (verified). Adding it is
  part of Fix D and makes Fix A unambiguously safe.

---

## 8. File / citation map

| Concern | File:line |
|---|---|
| **Throw site (the error)** | `src/main/hook-lease-manager.ts:105` |
| `ensureLease` branch ladder | `src/main/hook-lease-manager.ts:73-106` |
| Lease reuse condition (branch B) | `src/main/hook-lease-manager.ts:83-87` |
| Reclaim condition (branch C) | `src/main/hook-lease-manager.ts:92` |
| `instanceId` minted per-process (RC1) | `src/main/index.ts:601` |
| Manager construction (no TTL override) | `src/main/index.ts:599-602` |
| Lease TTL 20 s, lock 10 s | `src/main/hook-lease-registry.ts:89-90` |
| `reclaim` refuses active-not-expired (RC1 enforcer) | `src/main/hook-lease-registry.ts:202-204` |
| `isExpired` strict compare | `src/main/hook-lease-registry.ts:260-262` |
| Heartbeat 5 s default | `src/main/hook-lease-manager.ts:53` |
| Bootstrap recovery loop (no retry) (RC3) | `src/main/index.ts:2028-2030` |
| Recovery plan = all non-archived sessions | `src/core/project-session-manager.ts:370-383` |
| Guard catch → user-visible log + `markRuntimeFailedToStart` | `src/main/index.ts:1180-1184` |
| `launchTrackedSessionRuntime` → `ensureLease` | `src/main/launch-tracked-session-runtime.ts:52-57` |
| SR-owned path also calls `ensureLease` | `src/main/index.ts:1082` (via `:1202`) |
| `before-quit` → `prepareForQuitAndInstall` → `stop` (RC2) | `src/main/index.ts:2045-2062`, `:375` |
| `release` writes `leaseState:'released'` | `src/main/hook-lease-registry.ts:228-258` |
| Force-kill evidence (exit `0xC000013A`) | `tmp-startup-stdout.log:403` |
| No `requestSingleInstanceLock` in repo | (grep over `src/main/`, no hits) |
| Existing manager tests (no foreign-active case) | `src/main/hook-lease-manager.test.ts:19-121` |

---

## 9. One-line summary

Bootstrap recovery throws `Session <id> is owned by another STOA instance`
(`src/main/hook-lease-manager.ts:105`) because `instanceId` is reminted every
boot (`src/main/index.ts:601`) so any prior-boot lease is always foreign, and
force-killed processes never release their leases
(`release` runs only on the async `before-quit` chain at `index.ts:2045-2062`),
so the still-`active`, not-yet-expired (20 s TTL, `hook-lease-registry.ts:89`)
on-disk lease drives `ensureLease` into its throw branch with no retry — fix it
by letting recovery take over active-foreign leases (Fix A) and by releasing
leases on abnormal shutdown + registering `requestSingleInstanceLock` (Fix D).

---

## Context Handoff

- **Saved report path:** `research/2026-06-14-stoa-bootstrap-recovery-hook-lease-ownership-root-cause.md`
- **Primary root cause:** ephemeral `instanceId` (`index.ts:601`) + reclaim
  blocked inside the 20 s TTL (`hook-lease-registry.ts:202-204`).
- **Primary fix:** add a `force`/`takeover` path so bootstrap-recovery can
  reclaim active-foreign leases; pair with abnormal-shutdown release +
  `requestSingleInstanceLock`.
- **Ready to hand to:** an implementation agent targeting
  `src/main/hook-lease-manager.ts`, `src/main/hook-lease-registry.ts`,
  `src/main/launch-tracked-session-runtime.ts`, `src/main/index.ts`.
